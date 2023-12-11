// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { assert } from 'chai';
import { instance, mock, when } from 'ts-mockito';
import { Disposable, EventEmitter } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposable } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { createEventHandler } from '../../../test/common';
import { KernelFinder } from '../../kernelFinder';
import { LocalKernelConnectionMetadata, LocalKernelSpecConnectionMetadata } from '../../types';
import { ContributedLocalKernelSpecFinder } from './contributedLocalKernelSpecFinder.node';
import { ILocalKernelFinder } from './localKernelSpecFinderBase.node';
import { LocalKnownPathKernelSpecFinder } from './localKnownPathKernelSpecFinder.node';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';

suite(`Contributed Local Kernel Spec Finder`, () => {
    let finder: ContributedLocalKernelSpecFinder;
    let disposables: IDisposable[] = [];
    let nonPythonKernelFinder: LocalKnownPathKernelSpecFinder;
    let pythonKernelFinder: ILocalKernelFinder<LocalKernelConnectionMetadata>;
    let kernelFinder: KernelFinder;
    let extensionChecker: IPythonExtensionChecker;
    let interpreterService: IInterpreterService;
    let clock: fakeTimers.InstalledClock;
    let onDidChangeInterpreter: EventEmitter<PythonEnvironment | undefined>;
    let onDidChangeExtensions: EventEmitter<void>;
    let onDidChangeNonPythonKernels: EventEmitter<void>;
    let onDidChangePythonKernels: EventEmitter<void>;
    let onDidChangeInterpreterStatus: EventEmitter<void>;
    const javaKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'java',
        kernelSpec: {
            argv: ['java'],
            display_name: 'java',
            executable: 'java',
            name: 'java',
            language: 'java'
        }
    });
    const rustKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'rust',
        kernelSpec: {
            argv: ['rust'],
            display_name: 'rust',
            executable: 'rust',
            name: 'rust',
            language: 'rust'
        }
    });
    setup(() => {
        nonPythonKernelFinder = mock<LocalKnownPathKernelSpecFinder>();
        pythonKernelFinder = mock<ILocalKernelFinder<LocalKernelConnectionMetadata>>();
        kernelFinder = mock<KernelFinder>();
        extensionChecker = mock<IPythonExtensionChecker>();
        interpreterService = mock<IInterpreterService>();
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
        when(mockedVSCodeNamespaces.extensions.onDidChange).thenReturn(onDidChangeExtensions.event);
        when(nonPythonKernelFinder.status).thenReturn('idle');
        when(nonPythonKernelFinder.onDidChangeKernels).thenReturn(onDidChangeNonPythonKernels.event);
        when(pythonKernelFinder.status).thenReturn('idle');
        when(pythonKernelFinder.onDidChangeKernels).thenReturn(onDidChangePythonKernels.event);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        finder = new ContributedLocalKernelSpecFinder(
            instance(nonPythonKernelFinder),
            instance(pythonKernelFinder),
            instance(kernelFinder),
            disposables,
            instance(extensionChecker),
            instance(interpreterService)
        );

        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => (disposables = dispose(disposables)));
    test.only('No change event if there are no kernels', async () => {
        when(nonPythonKernelFinder.kernels).thenReturn([]);
        when(pythonKernelFinder.kernels).thenReturn([]);
        const statuses: (typeof finder.status)[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 0, 'onDidChangeKernels should not fire');
        assert.isAtLeast(onDidChangeStatus.count, 0, 'onDidChangeStatus should ont fire');
    });
    test('Status is discovering until Python extension finishes refreshing interpreters', async () => {
        when(nonPythonKernelFinder.kernels).thenReturn([]);
        when(pythonKernelFinder.kernels).thenReturn([]);
        when(interpreterService.status).thenReturn('refreshing');
        const statuses: (typeof finder.status)[] = [];
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
        when(nonPythonKernelFinder.kernels).thenReturn([]);
        when(pythonKernelFinder.kernels).thenReturn([]);
        const statuses: (typeof finder.status)[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeStatus = createEventHandler(finder, 'onDidChangeStatus', disposables);

        finder.activate();
        await clock.runAllAsync();

        // Ensure we start refreshing python interpreters
        when(interpreterService.status).thenReturn('refreshing');
        onDidChangeInterpreterStatus.fire();
        await clock.runAllAsync();

        // Now finish refreshing interpreters
        when(interpreterService.status).thenReturn('idle');
        onDidChangeInterpreterStatus.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeStatus.count, 2, 'onDidChangeStatus not fired 2 times');
        assert.deepEqual(statuses, ['discovering', 'idle']);
    });
    test('Notify status of discovery', async () => {
        when(nonPythonKernelFinder.kernels).thenReturn([javaKernelSpec]);
        when(pythonKernelFinder.kernels).thenReturn([]);
        const statuses: (typeof finder.status)[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels not fired');
    });
    test('Re-discover if there are changes to python interpreters and we have a new kernel spec', async () => {
        when(nonPythonKernelFinder.kernels).thenReturn([javaKernelSpec]);
        when(pythonKernelFinder.kernels).thenReturn([]);
        const statuses: (typeof finder.status)[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels not fired');

        when(pythonKernelFinder.kernels).thenReturn([rustKernelSpec]);
        onDidChangePythonKernels.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 2, 'onDidChangeKernels not fired');
    });
    test('Re-discover if there are changes to python interpreters without any new kernels', async () => {
        when(nonPythonKernelFinder.kernels).thenReturn([javaKernelSpec]);
        when(pythonKernelFinder.kernels).thenReturn([]);
        const statuses: (typeof finder.status)[] = [];
        finder.onDidChangeStatus(() => statuses.push(finder.status));
        const onDidChangeKernels = createEventHandler(finder, 'onDidChangeKernels', disposables);

        finder.activate();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels not fired');

        onDidChangePythonKernels.fire();
        await clock.runAllAsync();

        assert.isAtLeast(onDidChangeKernels.count, 1, 'onDidChangeKernels should not have been fired again fired');
    });
});
