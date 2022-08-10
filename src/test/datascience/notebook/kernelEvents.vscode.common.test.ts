// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable no-void */
/* eslint-disable @typescript-eslint/no-explicit-any */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { Disposable } from 'vscode';
import { traceInfo } from '../../../platform/logging';
import {
    IConfigurationService,
    IDisposable,
    IWatchableJupyterSettings,
    ReadWrite
} from '../../../platform/common/types';
import { IExtensionTestApi, startJupyterServer, waitForCondition } from '../../common';
import { initialize } from '../../initialize';
import {
    runCell,
    insertCodeCell,
    waitForTextOutput,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook
} from './helper';
import { createEventHandler } from '../../common';
import { IKernelProvider } from '../../../kernels/types';

suite('Kernel Event', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let configSettings: ReadWrite<IWatchableJupyterSettings>;
    let kernelProvider: IKernelProvider;
    let previousDisableJupyterAutoStartValue: boolean;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Suite Setup ${this.currentTest?.title}`);
        this.timeout(120_000);
        try {
            api = await initialize();
            sinon.restore();
            kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
            const configService = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
            configSettings = configService.getSettings(undefined) as any;
            previousDisableJupyterAutoStartValue = configSettings.disableJupyterAutoStart;
            configSettings.disableJupyterAutoStart = true;
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            traceInfo('Suite Setup (failed)');
            throw e;
        }
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            const configService = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
            configSettings = configService.getSettings(undefined) as any;
            configSettings.disableJupyterAutoStart = true;
            await startJupyterServer();
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        configSettings.disableJupyterAutoStart = previousDisableJupyterAutoStartValue;
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Kernel Events', async function () {
        const kernelCreated = createEventHandler(kernelProvider, 'onDidCreateKernel', disposables);
        const kernelStarted = createEventHandler(kernelProvider, 'onDidStartKernel', disposables);
        const kernelDisposed = createEventHandler(kernelProvider, 'onDidDisposeKernel', disposables);
        const kernelRestarted = createEventHandler(kernelProvider, 'onDidRestartKernel', disposables);
        const kernelStatusChanged = createEventHandler(kernelProvider, 'onKernelStatusChanged', disposables);

        const nb = await createEmptyPythonNotebook(disposables);
        await waitForCondition(async () => !!kernelProvider.get(nb), 5_000, 'Kernel not created');
        const kernel = kernelProvider.get(nb)!;
        const startedEvent = createEventHandler(kernel, 'onStarted', disposables);
        const onPreExecuteEvent = createEventHandler(kernel, 'onPreExecute', disposables);
        const onStatusChangeEvent = createEventHandler(kernel, 'onStatusChanged', disposables);
        const onDisposed = createEventHandler(kernel, 'onDisposed', disposables);
        const restartEvent = createEventHandler(kernel, 'onRestarted', disposables);

        const cell = await insertCodeCell('print("cell1")', { index: 0 });
        await Promise.all([runCell(cell), waitForTextOutput(cell, 'cell1')]);

        assert.isTrue(kernelCreated.fired, 'IKernelProvider.onDidCreateKernel not fired');
        assert.isTrue(kernelStarted.fired, 'IKernelProvider.onDidStartKernel not fired');
        assert.isTrue(kernelStatusChanged.fired, 'IKernelProvider.onKernelStatusChanged not fired');
        assert.isFalse(kernelRestarted.fired, 'IKernelProvider.onDidRestartKernel should not have fired');
        assert.isFalse(kernelDisposed.fired, 'IKernelProvider.onDidDisposeKernel should not have fired');

        assert.equal(onPreExecuteEvent.first, cell, 'Incorrect cell');
        assert.isTrue(startedEvent.fired, 'IKernel.onStarted not fired');
        assert.isTrue(onPreExecuteEvent.fired, 'IKernel.onPreExecute not fired');
        assert.isTrue(onStatusChangeEvent.fired, 'IKernel.onStatusChanged not fired');
        assert.isFalse(restartEvent.fired, 'IKernel.onRestarted event should not have fired');
        assert.isFalse(onDisposed.fired, 'IKernel.onDisposed event should not have fired');

        await kernel.restart();
        assert.isTrue(restartEvent.fired, 'IKernel.onRestarted event not fired');
        assert.isFalse(onDisposed.fired, 'IKernel.onDisposed event should not have fired');
        assert.isTrue(kernelRestarted.fired, 'IKernelProvider.onDidRestartKernel not fired');
        assert.isFalse(kernelDisposed.fired, 'IKernelProvider.onDidDisposeKernel should not have fired');

        await kernel.dispose();
        assert.isTrue(onDisposed.fired, 'Disposed event not fired');
        assert.isTrue(kernelDisposed.fired, 'IKernelProvider.onDidDisposeKernel not fired');
    });
    test('Kernel.IKernelConnection Events', async () => {
        const nb = await createEmptyPythonNotebook(disposables);
        await waitForCondition(async () => !!kernelProvider.get(nb), 5_000, 'Kernel not created');
        const kernel = kernelProvider.get(nb)!;
        const onPreExecuteEvent = createEventHandler(kernel, 'onPreExecute', disposables);

        const cell = await insertCodeCell('print("cell1")', { index: 0 });
        await Promise.all([runCell(cell), waitForTextOutput(cell, 'cell1')]);

        const kernelConnection = kernelProvider.get(nb)!.session!.kernel!;
        assert.strictEqual(onPreExecuteEvent.count, 1, 'Pre-execute should be fired once');
        assert.equal(onPreExecuteEvent.first, cell, 'Incorrect cell');

        let gotAnyMessage = false;
        let gotIOPubMessage = false;
        let statusChanged = false;
        const onAnyMessage = () => (gotAnyMessage = true);
        const onIOPubMessage = () => (gotIOPubMessage = true);
        const onStatusChanged = () => (statusChanged = true);
        kernelConnection.anyMessage.connect(onAnyMessage);
        kernelConnection.iopubMessage.connect(onIOPubMessage);
        kernelConnection.statusChanged.connect(onStatusChanged);
        disposables.push(new Disposable(() => void kernelConnection.anyMessage.disconnect(onAnyMessage)));
        disposables.push(new Disposable(() => void kernelConnection.iopubMessage.disconnect(onIOPubMessage)));
        disposables.push(new Disposable(() => void kernelConnection.statusChanged.disconnect(onStatusChanged)));

        const cell2 = await insertCodeCell('print("cell2")', { index: 0 });
        await Promise.all([runCell(cell2), waitForTextOutput(cell2, 'cell2')]);

        assert.strictEqual(onPreExecuteEvent.count, 2, 'Pre-execute should be fired twice');
        assert.equal(onPreExecuteEvent.second, cell2, 'Incorrect cell');

        assert.isTrue(gotAnyMessage, 'AnyMessage event not fired');
        assert.isTrue(gotIOPubMessage, 'IOPubMessage event fired');
        assert.isTrue(statusChanged, 'StatusChange event fired');

        // Restart the kernel & verify we still get the events fired.
        gotAnyMessage = false;
        gotIOPubMessage = false;
        statusChanged = false;
        await kernel.restart();

        const cell3 = await insertCodeCell('print("cell3")', { index: 0 });
        await Promise.all([runCell(cell3), waitForTextOutput(cell3, 'cell3')]);

        assert.isTrue(gotAnyMessage, 'AnyMessage event not fired after restarting the kernel');
        assert.isTrue(gotIOPubMessage, 'IOPubMessage event fired after restarting the kernel');
        assert.isTrue(statusChanged, 'StatusChange event fired after restarting the kernel');
    });
});
