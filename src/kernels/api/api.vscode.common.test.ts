// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationTokenSource, NotebookCellKind, NotebookCellOutputItem } from 'vscode';
import { traceInfo } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import {
    captureScreenShot,
    createEventHandler,
    initialize,
    startJupyterServer,
    suiteMandatory,
    testMandatory,
    waitForCondition
} from '../../test/common';
import { IS_REMOTE_NATIVE_TEST } from '../../test/constants';
import { getControllerForKernelSpec } from '../../test/datascience/notebook/helper';
import { getKernelsApi } from './api';
import { raceTimeoutError } from '../../platform/common/utils/async';
import { ExecutionResult } from '../../api';
import { dispose } from '../../platform/common/utils/lifecycle';
import { createMockedNotebookDocument } from '../../test/datascience/editor-integration/helpers';
import { IKernel, IKernelProvider } from '../types';
import { noop } from '../../test/core';
import { ServiceContainer } from '../../platform/ioc/container';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { IVSCodeNotebookController } from '../../notebooks/controllers/types';

suiteMandatory('Kernel API Tests @mandatory @nonPython', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    let kernelProvider: IKernelProvider;
    const kernelsToDispose: IKernel[] = [];
    const notebook = createMockedNotebookDocument([
        { kind: NotebookCellKind.Code, languageId: 'python', value: 'print(1234)' }
    ]);
    let controller: IVSCodeNotebookController;
    let realKernel: IKernel;
    suiteSetup(async function () {
        this.timeout(120_000);
        const api = await initialize();
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        if (IS_REMOTE_NATIVE_TEST()) {
            await startJupyterServer();
        }
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        controller = await getControllerForKernelSpec(30_000, { language: 'python' });
        sinon
            .stub(ServiceContainer.instance.get<IVSCodeNotebook>(IVSCodeNotebook), 'notebookDocuments')
            .get(() => [notebook]);
        realKernel = kernelProvider.getOrCreate(notebook, {
            controller: controller.controller,
            metadata: controller.connection,
            resourceUri: notebook.uri
        });
        kernelsToDispose.push(realKernel);

        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        sinon.restore();
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }

        if (!IS_REMOTE_NATIVE_TEST()) {
            // Do not shutdown kernels when running on remote.
            await Promise.all(kernelsToDispose.map((p) => p.dispose().catch(noop)));
        }
        kernelsToDispose.length = 0;
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    test('No kernel returned if no code has been executed', async function () {
        const kernel = getKernelsApi().findKernel({ uri: notebook.uri });

        assert.isUndefined(kernel, 'Kernel should not be returned as no code was executed');
    });
    testMandatory('Get Kernel and execute code', async function () {
        // No kernel unless we execute code against this kernel.
        assert.isUndefined(getKernelsApi().findKernel({ uri: notebook.uri }));

        await realKernel.start();

        getKernelsApi().findKernel({ uri: notebook.uri });

        // Ensure user has executed some code against this kernel.
        sinon.stub(kernelProvider.getKernelExecution(realKernel), 'executionCount').get(() => 1);
        const kernel = getKernelsApi().findKernel({ uri: notebook.uri });
        if (!kernel) {
            throw new Error('Kernel not found');
        }
        const statusChange = createEventHandler(kernel, 'onDidChangeStatus', disposables);

        // Verify we can execute code using the kernel.
        traceInfo(`Execute code silently`);
        const expectedMime = NotebookCellOutputItem.stdout('').mime;
        const token = new CancellationTokenSource();
        await waitForOutput(kernel.executeCode('print(1234)', token.token), '1234', expectedMime);
        traceInfo(`Execute code silently completed`);
        // Wait for kernel to be idle.
        await waitForCondition(
            () => kernel.status === 'idle',
            5_000,
            `Kernel did not become idle, current status is ${kernel.status}`
        );

        // Verify state transition.
        assert.deepEqual(Array.from(new Set(statusChange.all)), ['busy', 'idle'], 'States are incorrect');

        // Verify we can execute code using the kernel in parallel.
        await Promise.all([
            waitForOutput(kernel.executeCode('print(1)', token.token), '1', expectedMime),
            waitForOutput(kernel.executeCode('print(2)', token.token), '2', expectedMime),
            waitForOutput(kernel.executeCode('print(3)', token.token), '3', expectedMime)
        ]);

        // Wait for kernel to be idle.
        await waitForCondition(
            () => kernel.status === 'idle',
            5_000,
            `Kernel did not become idle, current status is ${kernel.status}`
        );
    });

    async function waitForOutput(executionResult: ExecutionResult, expectedOutput: string, expectedMimetype: string) {
        const disposables: IDisposable[] = [];
        const outputsReceived: string[] = [];
        const outputPromise = new Promise<void>((resolve, reject) => {
            executionResult.onDidEmitOutput(
                (e) => {
                    traceInfo(`Output received ${e.length} & mime types are ${e.map((item) => item.mime).join(', ')}}`);
                    e.forEach((item) => {
                        if (item.mime === expectedMimetype) {
                            const output = new TextDecoder().decode(item.data).trim();
                            if (output === expectedOutput.trim()) {
                                resolve();
                            } else {
                                reject(new Error(`Unexpected output ${output}`));
                            }
                        } else {
                            outputsReceived.push(`${item.mime} ${new TextDecoder().decode(item.data).trim()}`);
                        }
                    });
                },
                undefined,
                disposables
            );
        });

        await raceTimeoutError(
            30_000,
            new Error(`Timed out waiting for output, got ${outputsReceived}`),
            outputPromise
        ).finally(() => dispose(disposables));
    }
});
