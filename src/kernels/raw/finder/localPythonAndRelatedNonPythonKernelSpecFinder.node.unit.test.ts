// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import * as sinon from 'sinon';
import { Disposable, Memento, Uri, EventEmitter } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationEnvironment, IWorkspaceService } from '../../../platform/common/application/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { KernelPickerType } from '../../../platform/common/kernelPickerType';
import { IDisposable, IFeaturesManager } from '../../../platform/common/types';
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
import { anything, instance, mock, when } from 'ts-mockito';

suite('Local Python and related kernels (new Kernel Picker)', () => {
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
    const condaKernelSpec = PythonKernelConnectionMetadata.create({
        id: 'conda',
        interpreter: {
            id: 'conda',
            sysPrefix: '',
            uri: Uri.file('conda')
        },
        kernelSpec: {
            argv: ['python'],
            display_name: 'Conda',
            executable: 'conda',
            name: 'conda',
            env: {
                CUSTOM: '1'
            }
        }
    });
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

    setup(() => {
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
        when(interpreterService.onDidChangeInterpreters).thenReturn(onDidChangeInterpreters.event);
        when(kernelSpecsFromKnownLocations.onDidChangeKernels).thenReturn(onDidChangeKernelsFromKnownLocations.event);
        when(env.extensionVersion).thenReturn('1');
        when(fs.exists(anything())).thenResolve(true);

        const featuresManager = mock<IFeaturesManager>();
        when(featuresManager.features).thenReturn({ kernelPickerType: 'Stable' });

        const stub = sinon.stub(KernelPickerType, 'useNewKernelPicker').returns(true);
        clock = fakeTimers.install();

        disposables.push(new Disposable(() => stub.restore()));
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
            kernels: [pythonKernelSpec.toJSON(), condaKernelSpec.toJSON(), javaKernelSpec.toJSON()]
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
            condaKernelSpec.interpreter
        ]);
        const statues: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statues.push(finder.status), this, disposables);
        when(globalState.get(LocalPythonKernelsCacheKey, anything())).thenCall((_, defaultValue) => defaultValue);
        finder.activate();

        await clock.runAllAsync();

        assert.strictEqual(finder.kernels.length, 0);
    });
});
