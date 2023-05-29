// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { assert } from 'chai';
import { instance, mock, when } from 'ts-mockito';
import { Disposable, EventEmitter, Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable, IExtensions } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { createEventHandler } from '../../../test/common';
import { KernelFinder } from '../../kernelFinder';
import {
    LocalKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../types';
import { ContributedLocalPythonEnvFinder } from './contributedLocalPythonEnvFinder.node';
import { ILocalKernelFinder } from './localKernelSpecFinderBase.node';

suite('Contributed Python Kernel Finder', () => {
    let finder: ContributedLocalPythonEnvFinder;
    const disposables: IDisposable[] = [];
    let pythonKernelFinder: ILocalKernelFinder<LocalKernelConnectionMetadata>;
    let kernelFinder: KernelFinder;
    let extensionChecker: IPythonExtensionChecker;
    let interpreterService: IInterpreterService;
    let extensions: IExtensions;
    let clock: fakeTimers.InstalledClock;
    let onDidChangeInterpreter: EventEmitter<PythonEnvironment | undefined>;
    let onDidChangeExtensions: EventEmitter<void>;
    let onDidChangeNonPythonKernels: EventEmitter<void>;
    let onDidChangePythonKernels: EventEmitter<void>;
    let onDidChangeInterpreterStatus: EventEmitter<void>;
    const javaKernelSpec = LocalKernelSpecConnectionMetadata.create({
        kernelSpec: {
            argv: ['java'],
            display_name: 'java',
            executable: 'java',
            name: 'java',
            language: 'java'
        }
    });
    const pythonKernelSpec = PythonKernelConnectionMetadata.create({
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
        interpreter: {
            id: 'conda',
            sysPrefix: '',
            uri: Uri.file('conda')
        },
        kernelSpec: {
            argv: ['python'],
            display_name: 'Conda',
            executable: 'conda',
            name: 'conda'
        }
    });
    setup(() => {
        pythonKernelFinder = mock<ILocalKernelFinder<LocalKernelConnectionMetadata>>();
        kernelFinder = mock<KernelFinder>();
        extensionChecker = mock<IPythonExtensionChecker>();
        interpreterService = mock<IInterpreterService>();
        extensions = mock<IExtensions>();
        onDidChangeInterpreter = new EventEmitter<PythonEnvironment | undefined>();
        onDidChangeExtensions = new EventEmitter<void>();
        onDidChangeNonPythonKernels = new EventEmitter<void>();
        onDidChangePythonKernels = new EventEmitter<void>();
        onDidChangeInterpreterStatus = new EventEmitter<void>();
        disposables.push(onDidChangeInterpreter);
        disposables.push(onDidChangeExtensions);
        disposables.push(onDidChangeNonPythonKernels);
        disposables.push(onDidChangePythonKernels);
        disposables.push(onDidChangeInterpreterStatus);
        when(interpreterService.status).thenReturn('idle');
        when(interpreterService.onDidChangeInterpreter).thenReturn(onDidChangeInterpreter.event);
        when(interpreterService.onDidChangeStatus).thenReturn(onDidChangeInterpreterStatus.event);
        when(extensions.onDidChange).thenReturn(onDidChangeExtensions.event);
        when(pythonKernelFinder.status).thenReturn('idle');
        when(pythonKernelFinder.onDidChangeKernels).thenReturn(onDidChangePythonKernels.event);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        finder = new ContributedLocalPythonEnvFinder(
            instance(pythonKernelFinder),
            instance(kernelFinder),
            disposables,
            instance(extensionChecker),
            instance(interpreterService),
            instance(extensions)
        );

        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => disposeAllDisposables(disposables));
    test('No change event if there are no kernels', async () => {
        when(pythonKernelFinder.kernels).thenReturn([]);
        const statuses: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 0, 'onDidChangeKernels not fired');
        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);
    });
    test('Status is discovering until Python extension finishes refreshing interpreters', async () => {
        when(pythonKernelFinder.kernels).thenReturn([]);
        when(interpreterService.status).thenReturn('refreshing');
        const statuses: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 0, 'onDidChangeKernels not fired');
        assert.isAtLeast(onDidChangeStatus.count, 1, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering']);

        // Finish refreshing interpreters
        when(interpreterService.status).thenReturn('idle');
        onDidChangeInterpreterStatus.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);
    });
    test('Status is discovering if Python extension starts refreshing interpreters', async () => {
        when(pythonKernelFinder.kernels).thenReturn([]);
        const statuses: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);

        // Ensure we start refreshing python interpreters
        when(interpreterService.status).thenReturn('refreshing');
        onDidChangeInterpreterStatus.fire();
        await clock.runAllAsync();

        // Now finish refreshing interpreters
        when(interpreterService.status).thenReturn('idle');
        onDidChangeInterpreterStatus.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeStatus.count, 4, 'onDidChangeStatus not fired 4 times');
        assert.deepEqual(statuses, ['discovering', 'idle', 'discovering', 'idle']);
    });

    test('Notify status of discovery', async () => {
        when(pythonKernelFinder.kernels).thenReturn([pythonKernelSpec]);
        const statuses: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels not fired');
        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);
    });
    test('Re-discover if there are changes to python interpreters and we have a new kernel spec', async () => {
        when(pythonKernelFinder.kernels).thenReturn([pythonKernelSpec]);
        const statuses: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels not fired');
        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);

        when(pythonKernelFinder.kernels).thenReturn([pythonKernelSpec, condaKernelSpec]);
        onDidChangePythonKernels.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 2, 'onDidChangeKernels not fired');
        assert.isAtLeast(onDidChangeStatus.count, 4, 'onDidChangeStatus not fired 4 times');
        assert.deepEqual(statuses, ['discovering', 'idle', 'discovering', 'idle']);
    });
    test('Re-discover if there are changes to python interpreters without any new kernels', async () => {
        when(pythonKernelFinder.kernels).thenReturn([pythonKernelSpec]);
        const statuses: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels not fired');
        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);

        onDidChangePythonKernels.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels should not have been fired again fired');
        assert.isAtLeast(onDidChangeStatus.count, 4, 'onDidChangeStatus not fired 4 times');
        assert.deepEqual(statuses, ['discovering', 'idle', 'discovering', 'idle']);
    });
    test('Re-discover if there are changes to python interpreters without any new Python kernels', async () => {
        when(pythonKernelFinder.kernels).thenReturn([pythonKernelSpec]);
        const statuses: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels not fired');
        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);

        when(pythonKernelFinder.kernels).thenReturn([pythonKernelSpec, javaKernelSpec]);
        onDidChangePythonKernels.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels should not have been fired again fired');
        assert.isAtLeast(onDidChangeStatus.count, 4, 'onDidChangeStatus not fired 4 times');
        assert.deepEqual(statuses, ['discovering', 'idle', 'discovering', 'idle']);
    });
    test('Update status if interpreters are being refreshed', async () => {
        when(pythonKernelFinder.kernels).thenReturn([pythonKernelSpec]);
        const statuses: typeof finder.status[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels not fired');
        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);

        when(interpreterService.status).thenReturn('refreshing');
        onDidChangeInterpreterStatus.fire();
        when(interpreterService.status).thenReturn('idle');
        onDidChangeInterpreterStatus.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels should not have been fired again fired');
        assert.isAtLeast(onDidChangeStatus.count, 4, 'onDidChangeStatus not fired 4 times');
        assert.deepEqual(statuses, ['discovering', 'idle', 'discovering', 'idle']);
    });
});
