// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import * as sinon from 'sinon';
import { Disposable, Memento, Uri, EventEmitter } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationEnvironment, IWorkspaceService } from '../../../platform/common/application/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, IFeaturesManager, KernelPickerType } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { LocalKernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../../types';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import {
    LocalPythonAndRelatedNonPythonKernelSpecFinder,
    LocalPythonKernelsCacheKey
} from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { ITrustedKernelPaths } from './types';
import { JupyterPaths } from './jupyterPaths.node';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { assert } from 'chai';
import { createEventHandler } from '../../../test/common';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { KernelSpecFileWithContainingInterpreter, LocalKernelSpecFinder } from './localKernelSpecFinderBase.node';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { noop } from '../../../platform/common/utils/misc';
import { createInterpreterKernelSpec, getKernelId } from '../../helpers';

(['Stable', 'Insiders'] as KernelPickerType[]).forEach((kernelPickerType) => {
    suite(`Local Python and related kernels (Kernel Picker = ${kernelPickerType})`, async () => {
        let finder: LocalPythonAndRelatedNonPythonKernelSpecFinder;
        let interpreterService: IInterpreterService;
        let fs: IFileSystemNode;
        let workspaceService: IWorkspaceService;
        let extensionChecker: IPythonExtensionChecker;
        let kernelSpecsFromKnownLocations: LocalKnownPathKernelSpecFinder;
        let globalState: Memento;
        const disposables: IDisposable[] = [];
        let env: IApplicationEnvironment;
        let trustedKernels: ITrustedKernelPaths;
        let clock: fakeTimers.InstalledClock;
        let jupyterPaths: JupyterPaths;
        let onDidChangeKernelsFromKnownLocations: EventEmitter<void>;
        let onDidChangeInterpreters: EventEmitter<void>;
        let tempDirForKernelSpecs = Uri.file('/tmp');
        let findKernelSpecsInPathsReturnValue: KernelSpecFileWithContainingInterpreter[] = [];
        const pythonKernelSpec = PythonKernelConnectionMetadata.create({
            id: 'python',
            interpreter: {
                id: 'python',
                sysPrefix: '',
                uri: Uri.file('python')
            },
            kernelSpec: {
                argv: ['python'],
                display_name: 'python',
                executable: 'python',
                name: 'python'
            }
        });
        const condaInterpreter: PythonEnvironment = {
            id: 'conda',
            sysPrefix: '',
            uri: Uri.file('conda')
        };
        let condaKernel: PythonKernelConnectionMetadata;
        const javaKernelSpec = LocalKernelSpecConnectionMetadata.create({
            id: 'java',
            // This kernelspec belongs to the conda env.
            interpreter: {
                id: 'conda',
                sysPrefix: '',
                uri: Uri.file('conda')
            },
            kernelSpec: {
                argv: ['java'],
                display_name: 'java',
                executable: 'java',
                name: 'java',
                language: 'java',
                specFile: Uri.joinPath(Uri.file('java'), 'kernel.json').fsPath
            }
        });
        const venvInterpreter: PythonEnvironment = {
            id: 'venvPython',
            sysPrefix: 'home/venvPython',
            uri: Uri.file('home/venvPython/bin/python')
        };
        let venvPythonKernel: PythonKernelConnectionMetadata;

        setup(async () => {
            interpreterService = mock<IInterpreterService>();
            fs = mock<IFileSystemNode>();
            workspaceService = mock<IWorkspaceService>();
            jupyterPaths = mock<JupyterPaths>();
            extensionChecker = mock<IPythonExtensionChecker>();
            kernelSpecsFromKnownLocations = mock(LocalKnownPathKernelSpecFinder);
            globalState = mock<Memento>();
            env = mock<IApplicationEnvironment>();
            trustedKernels = mock<ITrustedKernelPaths>();
            onDidChangeKernelsFromKnownLocations = new EventEmitter<void>();
            onDidChangeInterpreters = new EventEmitter<void>();
            disposables.push(onDidChangeKernelsFromKnownLocations);
            disposables.push(onDidChangeInterpreters);

            findKernelSpecsInPathsReturnValue = [];

            when(globalState.get(anything(), anything())).thenCall((_, defaultValue) => defaultValue);
            when(globalState.update(anything(), anything())).thenResolve();
            when(interpreterService.onDidChangeInterpreters).thenReturn(onDidChangeInterpreters.event);
            when(interpreterService.getActiveInterpreter()).thenResolve();
            when(interpreterService.getActiveInterpreter(anything())).thenResolve();
            when(kernelSpecsFromKnownLocations.onDidChangeKernels).thenReturn(
                onDidChangeKernelsFromKnownLocations.event
            );
            when(env.extensionVersion).thenReturn('1');
            when(fs.exists(anything())).thenResolve(true);
            when(jupyterPaths.getKernelSpecTempRegistrationFolder()).thenResolve(tempDirForKernelSpecs);
            const featuresManager = mock<IFeaturesManager>();
            when(featuresManager.features).thenReturn({ kernelPickerType });
            when(jupyterPaths.getKernelSpecRootPaths(anything())).thenResolve([]);
            when(jupyterPaths.getKernelSpecRootPath()).thenResolve();

            // Initialize the kernel specs (test data).
            let kernelSpec = await createInterpreterKernelSpec(venvInterpreter, tempDirForKernelSpecs);
            venvPythonKernel = PythonKernelConnectionMetadata.create({
                id: getKernelId(kernelSpec, venvInterpreter),
                interpreter: venvInterpreter,
                kernelSpec
            });
            kernelSpec = await createInterpreterKernelSpec(condaInterpreter, tempDirForKernelSpecs);
            condaKernel = PythonKernelConnectionMetadata.create({
                id: getKernelId(kernelSpec, condaInterpreter),
                interpreter: condaInterpreter,
                kernelSpec
            });

            clock = fakeTimers.install();

            disposables.push(new Disposable(() => clock.uninstall()));

            finder = new LocalPythonAndRelatedNonPythonKernelSpecFinder(
                instance(interpreterService),
                instance(fs),
                instance(workspaceService),
                instance(jupyterPaths),
                instance(extensionChecker),
                instance(kernelSpecsFromKnownLocations),
                instance(globalState),
                disposables,
                instance(env),
                instance(trustedKernels),
                instance(featuresManager)
            );

            const findStub = sinon.stub(LocalKernelSpecFinder.prototype, 'findKernelSpecsInPaths');
            findStub.callsFake(async () => findKernelSpecsInPathsReturnValue);
            disposables.push(new Disposable(() => findStub.restore()));

            const loadKernelSpecStub = sinon.stub(LocalKernelSpecFinder.prototype, 'getKernelSpec');
            loadKernelSpecStub.callsFake(async (file, _, interpreter, __) => {
                return {
                    specFile: file.fsPath,
                    argv: ['bin/python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
                    display_name: interpreter?.displayName || interpreter?.id || '',
                    executable: interpreter?.uri?.fsPath || interpreter?.id || '',
                    name: interpreter?.displayName || interpreter?.id || '',
                    language: PYTHON_LANGUAGE
                    // interpreterPath: 'some Path' + (interpreter?.uri?.fsPath || interpreter?.id || '')
                };
            });
            disposables.push(new Disposable(() => loadKernelSpecStub.restore()));
        });
        teardown(() => disposeAllDisposables(disposables));

        test('Nothing found in cache', async () => {
            const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels');
            const statues: typeof finder.status[] = [];
            finder.onDidChangeStatus(() => statues.push(finder.status), this, disposables);
            when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenCall((_, defaultValue) => defaultValue);
            finder.activate();

            await clock.runAllAsync();

            assert.strictEqual(onDidChangeKernels.count, 0); // fired at least once.
            assert.include(statues[0], 'discovering'); // First should be discovering.
            assert.strictEqual(statues[statues.length - 1], 'idle'); // Last status should be idle
            assert.strictEqual(finder.kernels.length, 0);
        });
        test('Lists kernels from cache', async () => {
            const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels');
            const statues: typeof finder.status[] = [];
            finder.onDidChangeStatus(() => statues.push(finder.status), this, disposables);
            const kernelsInCache = {
                extensionVersion: '1',
                kernels: [pythonKernelSpec.toJSON(), condaKernel.toJSON(), javaKernelSpec.toJSON()]
            };
            when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenReturn(kernelsInCache);
            finder.activate();

            await clock.runAllAsync();

            assert.isAtLeast(onDidChangeKernels.count, 1); // fired at least once.
            assert.include(statues[0], 'discovering'); // First should be discovering.
            assert.strictEqual(statues[statues.length - 1], 'idle'); // Last status should be idle
            assert.strictEqual(finder.kernels.length, 3);
            assert.deepEqual(finder.kernels.map((k) => k.id).sort(), kernelsInCache.kernels.map((k) => k.id).sort());
        });
        test('Discovers from interpreters', async () => {
            when(interpreterService.resolvedEnvironments).thenReturn([
                pythonKernelSpec.interpreter,
                condaKernel.interpreter
            ]);
            const statues: typeof finder.status[] = [];
            finder.onDidChangeStatus(() => statues.push(finder.status), this, disposables);
            when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenCall((_, defaultValue) => defaultValue);
            finder.activate();

            await clock.runAllAsync();

            assert.strictEqual(finder.kernels.length, 0);
        });
        async function checkInterpreterDetails(isTrusted: boolean) {
            when(interpreterService.resolvedEnvironments).thenReturn([condaKernel.interpreter]);
            const statues: typeof finder.status[] = [];
            finder.onDidChangeStatus(() => statues.push(finder.status), undefined, disposables);
            when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenCall((_, defaultValue) => defaultValue);
            finder.activate();
            when(interpreterService.resolvedEnvironments).thenReturn([
                pythonKernelSpec.interpreter,
                condaKernel.interpreter
            ]);
            when(workspaceService.workspaceFolders).thenReturn([]);
            when(trustedKernels.isTrusted(anything())).thenReturn(isTrusted);
            when(jupyterPaths.getKernelSpecRootPaths(anything())).thenResolve([]);
            when(jupyterPaths.getKernelSpecRootPath()).thenResolve(Uri.file('root'));
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            findKernelSpecsInPathsReturnValue = [
                {
                    kernelSpecFile: Uri.file('pythonSpecFile'),
                    interpreter: pythonKernelSpec.interpreter
                },
                {
                    kernelSpecFile: Uri.file('condaSpecFile'),
                    interpreter: condaKernel.interpreter
                }
            ];
            when(interpreterService.getInterpreterDetails(anything())).thenResolve(undefined);

            await clock.runAllAsync();
        }
        test('Do not get interpreter information if kernel Spec is not trusted', async () => {
            await checkInterpreterDetails(false);

            verify(interpreterService.getInterpreterDetails(anything())).never();
        });
        test('Get interpreter information if kernel Spec is trusted', async () => {
            await checkInterpreterDetails(true);

            verify(interpreterService.getInterpreterDetails(anything())).once();
        });
        test('Get Python Envs as a Kernel', async () => {
            when(interpreterService.resolvedEnvironments).thenReturn([venvInterpreter, condaInterpreter]);
            when(workspaceService.workspaceFolders).thenReturn([]);
            when(trustedKernels.isTrusted(anything())).thenReturn(true);
            when(jupyterPaths.getKernelSpecRootPaths(anything())).thenResolve([]);
            when(jupyterPaths.getKernelSpecRootPath()).thenResolve(Uri.file('root'));
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);

            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(1);

            assert.lengthOf(
                finder.kernels,
                2,
                `Should have one kernel ${finder.kernels.map((item) => `${item.kind}:${item.id}`)}`
            );
            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);
        });
        test.skip('Get kernels from Python Environments', async () => {
            when(interpreterService.resolvedEnvironments).thenReturn([venvInterpreter, condaInterpreter]);
            when(workspaceService.workspaceFolders).thenReturn([]);
            when(trustedKernels.isTrusted(anything())).thenReturn(true);
            when(jupyterPaths.getKernelSpecRootPaths(anything())).thenResolve([]);
            when(jupyterPaths.getKernelSpecRootPath()).thenResolve(Uri.file('root'));
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);

            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(1);

            assert.lengthOf(
                finder.kernels,
                2,
                `Should have one kernel ${finder.kernels.map((item) => `${item.kind}:${item.id}`)}`
            );
            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);
        });
    });
});
