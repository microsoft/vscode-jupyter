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
import { IJupyterKernelSpec, LocalKernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../../types';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './localPythonAndRelatedNonPythonKernelSpecFinder.node';
import { ITrustedKernelPaths } from './types';
import { baseKernelPath, JupyterPaths } from './jupyterPaths.node';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { assert } from 'chai';
import { createEventHandler } from '../../../test/common';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { LocalKernelSpecFinder } from './localKernelSpecFinderBase.node';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { noop } from '../../../platform/common/utils/misc';
import { createInterpreterKernelSpec, getKernelId } from '../../helpers';
import { ResourceMap } from '../../../platform/vscode-path/map';
import { deserializePythonEnvironment, serializePythonEnvironment } from '../../../platform/api/pythonApi';
import { uriEquals } from '../../../test/datascience/helpers';
import { LocalPythonKernelsCacheKey } from './interpreterKernelSpecFinderHelper.node';
import { LocalPythonAndRelatedNonPythonKernelSpecFinderOld } from './localPythonAndRelatedNonPythonKernelSpecFinder.old.node';
import { traceInfo } from '../../../platform/logging';
import { sleep } from '../../../test/core';

(['Stable', 'Insiders'] as KernelPickerType[]).forEach((kernelPickerType) => {
    suite.only(`Local Python and related kernels (Kernel Picker = ${kernelPickerType})`, async () => {
        let finder: LocalPythonAndRelatedNonPythonKernelSpecFinder | LocalPythonAndRelatedNonPythonKernelSpecFinderOld;
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
        let onDidRemoveInterpreter: EventEmitter<{ id: string }>;
        let tempDirForKernelSpecs = Uri.file('/tmp');
        let findKernelSpecsInPathsReturnValue = new ResourceMap<Uri[]>();
        let loadKernelSpecReturnValue = new ResourceMap<IJupyterKernelSpec>();
        const globalKernelRootPath = Uri.file('root');
        const pythonKernelSpec = PythonKernelConnectionMetadata.create({
            id: 'python',
            interpreter: {
                id: 'python',
                sysPrefix: 'home/python',
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
            sysPrefix: 'home/conda',
            uri: Uri.file('conda')
        };
        const globalInterpreter: PythonEnvironment = {
            id: 'globalInterpreter',
            sysPrefix: 'home/global',
            uri: Uri.joinPath(Uri.file('globalSys'), 'bin', 'python')
        };
        let condaKernel: PythonKernelConnectionMetadata;

        const globalPythonKernelSpec = LocalKernelSpecConnectionMetadata.create({
            id: 'pythonGlobal',
            // This kernelspec belongs to the conda env.
            kernelSpec: {
                argv: [globalInterpreter.uri.fsPath, '-m', 'powershell_custom'],
                display_name: 'Custom Global Python kernel Spec',
                executable: globalInterpreter.uri.fsPath,
                name: 'python',
                language: 'python',
                specFile: Uri.joinPath(globalKernelRootPath, 'python', 'kernel.json').fsPath
            }
        });
        const globalPythonKernelSpecUnknownExecutable = LocalKernelSpecConnectionMetadata.create({
            id: 'pythonGlobalUnknown',
            // This kernelspec belongs to the conda env.
            kernelSpec: {
                argv: [Uri.joinPath(Uri.file('unknown'), 'bin', 'python').fsPath, '-m', 'powershell_custom'],
                display_name: 'Custom Global Python kernel Spec Unknown Executable',
                executable: Uri.joinPath(Uri.file('unknown'), 'bin', 'python').fsPath,
                name: 'python',
                language: 'python',
                specFile: Uri.joinPath(globalKernelRootPath, 'unknown', 'kernel.json').fsPath
            }
        });
        const globalJuliaKernelSpec = LocalKernelSpecConnectionMetadata.create({
            id: 'juliaGlobal',
            // This kernelspec belongs to the conda env.
            kernelSpec: {
                argv: ['julia'],
                display_name: 'Julia',
                executable: 'julia',
                name: 'julia',
                language: 'julia',
                specFile: Uri.joinPath(globalKernelRootPath, 'julia', 'kernel.json').fsPath
            }
        });
        const javaKernelSpec = LocalKernelSpecConnectionMetadata.create({
            id: 'java',
            // This kernelspec belongs to the conda env.
            interpreter: condaInterpreter,
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
            uri: Uri.file('home/venvPython/bin/python'),
            version: { major: 3, minor: 10, patch: 0, raw: '3.10.0' }
        };
        const cachedVenvInterpreterWithOlderVersionOfPython = {
            ...deserializePythonEnvironment(serializePythonEnvironment(venvInterpreter), venvInterpreter.id)!,
            version: { major: 3, minor: 8, patch: 0, raw: '3.8.0' }
        };

        let venvPythonKernel: PythonKernelConnectionMetadata;
        let cachedVenvPythonKernel: PythonKernelConnectionMetadata;

        setup(async function () {
            traceInfo(`Start Test (started) ${this.currentTest?.title}`);
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
            onDidRemoveInterpreter = new EventEmitter<{ id: string }>();
            onDidChangeInterpreters = new EventEmitter<void>();
            disposables.push(onDidChangeKernelsFromKnownLocations);
            disposables.push(onDidChangeInterpreters);
            disposables.push(onDidRemoveInterpreter);

            findKernelSpecsInPathsReturnValue.clear();
            loadKernelSpecReturnValue.clear();
            when(trustedKernels.isTrusted(anything())).thenReturn(true);
            when(globalState.get(anything(), anything())).thenCall((_, defaultValue) => defaultValue);
            when(globalState.update(anything(), anything())).thenResolve();
            when(interpreterService.onDidChangeInterpreters).thenReturn(onDidChangeInterpreters.event);
            when(interpreterService.onDidRemoveInterpreter).thenReturn(onDidRemoveInterpreter.event);
            when(interpreterService.getActiveInterpreter()).thenResolve();
            when(interpreterService.getActiveInterpreter(anything())).thenResolve();
            when(interpreterService.status).thenReturn('refreshing');
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            when(kernelSpecsFromKnownLocations.onDidChangeKernels).thenReturn(
                onDidChangeKernelsFromKnownLocations.event
            );
            when(env.extensionVersion).thenReturn('1');
            when(fs.exists(anything())).thenResolve(true);
            when(jupyterPaths.getKernelSpecTempRegistrationFolder()).thenResolve(tempDirForKernelSpecs);
            const featuresManager = mock<IFeaturesManager>();
            when(featuresManager.features).thenReturn({ kernelPickerType });
            when(jupyterPaths.getKernelSpecRootPaths(anything())).thenResolve([]);
            when(jupyterPaths.getKernelSpecRootPath()).thenResolve(globalKernelRootPath);
            when(workspaceService.workspaceFolders).thenReturn([]);

            // Initialize the kernel specs (test data).
            let kernelSpec = await createInterpreterKernelSpec(venvInterpreter, tempDirForKernelSpecs);
            venvPythonKernel = PythonKernelConnectionMetadata.create({
                id: getKernelId(kernelSpec, venvInterpreter),
                interpreter: venvInterpreter,
                kernelSpec
            });
            cachedVenvPythonKernel = PythonKernelConnectionMetadata.create({
                id: getKernelId(kernelSpec, cachedVenvInterpreterWithOlderVersionOfPython),
                interpreter: cachedVenvInterpreterWithOlderVersionOfPython,
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

            if (kernelPickerType === 'Insiders') {
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
                    instance(trustedKernels)
                );
            } else {
                finder = new LocalPythonAndRelatedNonPythonKernelSpecFinderOld(
                    instance(interpreterService),
                    instance(fs),
                    instance(workspaceService),
                    instance(jupyterPaths),
                    instance(extensionChecker),
                    instance(kernelSpecsFromKnownLocations),
                    instance(globalState),
                    disposables,
                    instance(env),
                    instance(trustedKernels)
                );
            }

            const findStub = sinon.stub(LocalKernelSpecFinder.prototype, 'findKernelSpecsInPaths');
            findStub.callsFake(async (searchPath) => findKernelSpecsInPathsReturnValue.get(searchPath) || []);
            disposables.push(new Disposable(() => findStub.restore()));

            const loadKernelSpecStub = sinon.stub(LocalKernelSpecFinder.prototype, 'loadKernelSpec');
            loadKernelSpecStub.callsFake(async (file, _, interpreter) => {
                return (
                    loadKernelSpecReturnValue.get(file) || {
                        specFile: file.fsPath,
                        argv: ['bin/python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
                        display_name: interpreter?.displayName || interpreter?.id || '',
                        executable: interpreter?.uri?.fsPath || interpreter?.id || '',
                        name: interpreter?.displayName || interpreter?.id || '',
                        language: PYTHON_LANGUAGE
                        // interpreterPath: 'some Path' + (interpreter?.uri?.fsPath || interpreter?.id || '')
                    }
                );
            });
            disposables.push(new Disposable(() => loadKernelSpecStub.restore()));
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        });
        teardown(async function () {
            traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
            await disposeAllDisposables(disposables);
        });

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
        test('Discovers kernels as interpreters', async () => {
            when(interpreterService.resolvedEnvironments).thenReturn([venvInterpreter, condaInterpreter]);
            const statues: typeof finder.status[] = [];
            finder.onDidChangeStatus(() => statues.push(finder.status), this, disposables);
            when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenCall((_, defaultValue) => defaultValue);
            finder.activate();

            await clock.runAllAsync();

            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);
        });
        test('Do not get interpreter information if kernel Spec is not trusted', async () => {
            console.error('Started Test 12345');
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([
                globalPythonKernelSpec,
                globalPythonKernelSpecUnknownExecutable,
                globalJuliaKernelSpec
            ]);

            when(interpreterService.resolvedEnvironments).thenReturn([
                globalInterpreter,
                pythonKernelSpec.interpreter,
                condaKernel.interpreter
            ]);
            when(trustedKernels.isTrusted(anything())).thenReturn(false);
            when(interpreterService.getInterpreterDetails(anything())).thenResolve(undefined);

            console.error('Started Test 12345 - Activated');
            finder.activate();
            console.error('Started Test 12345 - Run All');
            await clock.runAllAsync();
            await sleep(500);

            // Verify we checked whether its trusted & never attempted to read interpreter details.
            const uri = capture(trustedKernels.isTrusted).first()[0];
            assert.strictEqual(
                uri.fsPath,
                Uri.file(globalPythonKernelSpecUnknownExecutable.kernelSpec.specFile!).fsPath
            );
            verify(interpreterService.getInterpreterDetails(anything())).never();
        });
        test('Get interpreter information if kernel Spec is trusted', async () => {
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([
                globalPythonKernelSpec,
                globalPythonKernelSpecUnknownExecutable,
                globalJuliaKernelSpec
            ]);

            when(interpreterService.resolvedEnvironments).thenReturn([
                globalInterpreter,
                pythonKernelSpec.interpreter,
                condaKernel.interpreter
            ]);
            when(trustedKernels.isTrusted(anything())).thenReturn(true);
            when(interpreterService.getInterpreterDetails(anything())).thenResolve(undefined);

            finder.activate();
            await clock.runAllAsync();

            const uriOfUnknownExecutable = Uri.file(globalPythonKernelSpecUnknownExecutable.kernelSpec.argv[0]);

            // Verify we checked whether its trusted & attempted to read interpreter details.
            verify(
                trustedKernels.isTrusted(
                    uriEquals(Uri.file(globalPythonKernelSpecUnknownExecutable.kernelSpec.specFile!))
                )
            ).atLeast(1);
            verify(interpreterService.getInterpreterDetails(uriEquals(uriOfUnknownExecutable))).atLeast(1);
        });
        test('Get Python Envs as a Kernel', async () => {
            when(interpreterService.resolvedEnvironments).thenReturn([venvInterpreter, condaInterpreter]);
            when(trustedKernels.isTrusted(anything())).thenReturn(true);
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);

            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(1);

            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);
        });
        test('Find a matching interpreter for global kernel specs (when path to executable is in argv of kernelspec.json)', async function () {
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([globalPythonKernelSpec, globalJuliaKernelSpec]);
            when(interpreterService.resolvedEnvironments).thenReturn([globalInterpreter, condaKernel.interpreter]);

            const spec = await createInterpreterKernelSpec(globalInterpreter, tempDirForKernelSpecs);
            const expectedGlobalKernelSpec = LocalKernelSpecConnectionMetadata.create({
                id: getKernelId(globalPythonKernelSpec.kernelSpec, globalInterpreter),
                kernelSpec: globalPythonKernelSpec.kernelSpec,
                interpreter: globalInterpreter
            });
            const expectedGlobalKernel = PythonKernelConnectionMetadata.create({
                id: getKernelId(spec, globalInterpreter),
                interpreter: globalInterpreter,
                kernelSpec: spec
            });

            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);
            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(1);

            assert.deepEqual(
                finder.kernels.sort((a, b) => a.id.localeCompare(b.id)),
                [expectedGlobalKernelSpec, condaKernel, expectedGlobalKernel].sort((a, b) => a.id.localeCompare(b.id))
            );
        });
        test('Ignore Gloabl kernelspecs if we cannot find a matching interpreter (when path to executable is in argv of kernelspec.json)', async function () {
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([
                globalPythonKernelSpec,
                globalPythonKernelSpecUnknownExecutable,
                globalJuliaKernelSpec
            ]);
            when(interpreterService.resolvedEnvironments).thenReturn([globalInterpreter, condaKernel.interpreter]);
            const spec = await createInterpreterKernelSpec(globalInterpreter, tempDirForKernelSpecs);
            const expectedGlobalKernelSpec = LocalKernelSpecConnectionMetadata.create({
                id: getKernelId(globalPythonKernelSpec.kernelSpec, globalInterpreter),
                kernelSpec: globalPythonKernelSpec.kernelSpec,
                interpreter: globalInterpreter
            });
            const expectedGlobalKernel = PythonKernelConnectionMetadata.create({
                id: getKernelId(spec, globalInterpreter),
                interpreter: globalInterpreter,
                kernelSpec: spec
            });

            // Ensure we don't have interpreter details for this unknown kernlespec.
            when(
                interpreterService.getInterpreterDetails(
                    uriEquals(globalPythonKernelSpecUnknownExecutable.kernelSpec.argv[0])
                )
            ).thenResolve();

            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);
            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(1);

            assert.deepEqual(
                finder.kernels.sort((a, b) => a.id.localeCompare(b.id)),
                [expectedGlobalKernelSpec, condaKernel, expectedGlobalKernel].sort((a, b) => a.id.localeCompare(b.id))
            );
        });
        test('Get kernels from cache first and override cache with latest Env information from Python Extension', async function () {
            // Cache will have a virtual env of Python for 3.8.0
            // & later the user updates that same virtual env to 3.10.0 (either by deleting that folder and re-installing a new venv in the same folder or other means)
            // After we load, we need to ensure we display the new version of 3.10.0
            // This is something users have done quite a lot in the past.
            when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenReturn({
                kernels: [cachedVenvPythonKernel],
                extensionVersion: '1'
            });
            when(interpreterService.resolvedEnvironments).thenReturn([]);
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);

            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);
            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(1);

            // We should have the cached kernels.
            assert.deepEqual(finder.kernels, [cachedVenvPythonKernel]);

            // Now lets discover Python environments, and ensure we have 2 kernels, and one of the kernel has the updated Version of Python
            when(interpreterService.resolvedEnvironments).thenReturn([venvInterpreter, condaInterpreter]);
            onDidChangeInterpreters.fire();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(1);

            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);
        });
        test('Ensure cache does not override Python Envs retrieved from Python Extension (as the former is older information and latter is more recent)', async function () {
            when(interpreterService.resolvedEnvironments).thenReturn([venvInterpreter, condaInterpreter]);
            // Cache will have a virtual env of Python for 3.8.0
            // & later the user updates that same virtual env to 3.10.0 (either by deleting that folder and re-installing a new venv in the same folder or other means)
            // After we load, we need to ensure we display the new version of 3.10.0
            // This is something users have done quite a lot in the past.
            when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenReturn({
                kernels: [cachedVenvPythonKernel],
                extensionVersion: '1'
            });
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);

            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);
            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(2);

            // The cached kernel should not be listed as the Python env returned by Python extension is more recent.
            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);
        });
        test('Ensure old (non-existent) kernel from cache is no longer listed after its not in the list of Python envs returned by Python extension', async function () {
            if (kernelPickerType !== 'Insiders') {
                return this.skip();
            }
            // Python will never return the old Python environment.
            when(interpreterService.resolvedEnvironments).thenReturn([condaInterpreter]);
            // Cache will have a virtual env of Python
            // & later the Python extension no longer returns this Python env in the list of environments
            // At this point we should not list this kernel as its not a valid environment (not valid because Python doesn't list it anymore).
            when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenReturn({
                kernels: [venvPythonKernel],
                extensionVersion: '1'
            });
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            // Indication that Python is still busy refreshing interpreters
            when(interpreterService.status).thenReturn('refreshing');

            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);
            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(2);
            const numberOfTimesChangeEventTriggered = onDidChange.count;

            // The cached kernel should be listed as Python extension has not yet completed refreshing of interpreters.
            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);

            // Indication that we've finished discovering interpreters.
            when(interpreterService.status).thenReturn('idle');
            onDidChangeInterpreters.fire();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(numberOfTimesChangeEventTriggered + 1);

            // The cached kernel should no longer be listed anymore.
            assert.deepEqual(finder.kernels, [condaKernel]);
        });
        test('Ensure kernels are removed from the list after Python extension triggers a removal of an interpreter', async function () {
            if (kernelPickerType !== 'Insiders') {
                return this.skip();
            }
            // Python will first give us 2 interpreters.
            when(interpreterService.resolvedEnvironments).thenReturn([venvInterpreter, condaInterpreter]);
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            when(interpreterService.status).thenReturn('idle');

            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);
            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(2);
            const numberOfTimesChangeEventTriggered = onDidChange.count;

            // We should have two kernels for both python envs.
            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);

            // Now Python will only give us 1 environment.
            // Ie. the virtual env has been deleted.
            when(interpreterService.resolvedEnvironments).thenReturn([condaInterpreter]);
            onDidChangeInterpreters.fire();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(numberOfTimesChangeEventTriggered + 1);

            // We should no longer list the venv kernel.
            assert.deepEqual(finder.kernels, [condaKernel]);
        });
        test('Ensure kernels are removed from the list after Python extension triggers a removal of an interpreter (via removed event)', async function () {
            if (kernelPickerType !== 'Insiders') {
                return this.skip();
            }
            // Python will first give us 2 interpreters.
            when(interpreterService.resolvedEnvironments).thenReturn([venvInterpreter, condaInterpreter]);
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            when(interpreterService.status).thenReturn('idle');

            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);
            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(2);
            const numberOfTimesChangeEventTriggered = onDidChange.count;

            // We should have two kernels for both python envs.
            assert.deepEqual(finder.kernels, [venvPythonKernel, condaKernel]);

            // Now Python will only give us 1 environment.
            // Ie. the virtual env has been deleted.
            when(interpreterService.resolvedEnvironments).thenReturn([condaInterpreter]);
            onDidRemoveInterpreter.fire({ id: venvInterpreter.id });
            await clock.runAllAsync();
            assert.strictEqual(onDidChange.count, numberOfTimesChangeEventTriggered + 1, 'Event not fired');

            // We should no longer list the venv kernel.
            assert.deepEqual(finder.kernels, [condaKernel]);
        });
        test('Get kernel specs from Python Environments', async () => {
            when(kernelSpecsFromKnownLocations.kernels).thenReturn([]);
            when(interpreterService.resolvedEnvironments).thenReturn([condaInterpreter]);
            // Conda kernel should have a java kernelspec.
            findKernelSpecsInPathsReturnValue.set(
                Uri.joinPath(Uri.file(condaKernel.interpreter.sysPrefix!), baseKernelPath),
                [Uri.file(javaKernelSpec.kernelSpec.specFile!)]
            );
            // Java Kernel spec should load and return the kernelspec json.
            loadKernelSpecReturnValue.set(Uri.file(javaKernelSpec.kernelSpec.specFile!), javaKernelSpec.kernelSpec);
            const onDidChange = createEventHandler(finder, 'onDidChangeKernels', disposables);

            // We need to have a Kernel Spec that will be started using activated Python enviornment.
            const expectedJavaKernelSpec = PythonKernelConnectionMetadata.create({
                kernelSpec: javaKernelSpec.kernelSpec,
                interpreter: condaInterpreter,
                id: getKernelId(javaKernelSpec.kernelSpec, condaInterpreter)
            });

            finder.onDidChangeKernels(() => clock.runAllAsync().catch(noop));
            finder.activate();
            await clock.runAllAsync();
            await onDidChange.assertFiredAtLeast(1);

            // Verify we have found the java kernel spec inside the conda environment.
            assert.deepEqual(finder.kernels, [expectedJavaKernelSpec, condaKernel]);
        });
    });
});
