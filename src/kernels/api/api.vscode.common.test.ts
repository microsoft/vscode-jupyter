// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationTokenSource, NotebookCellOutputItem } from 'vscode';
import { traceInfo } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import {
    captureScreenShot,
    createEventHandler,
    initialize,
    startJupyterServer,
    testMandatory,
    waitForCondition
} from '../../test/common';
import { IS_REMOTE_NATIVE_TEST } from '../../test/constants';
import { closeNotebooksAndCleanUpAfterTests, getControllerForKernelSpec } from '../../test/datascience/notebook/helper';
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

suite('Kernel API Tests @mandatory @nonPython', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
    this.retries(1);
    let kernelProvider: IKernelProvider;
    const denoKernelSpec = { display_name: 'Deno', name: 'deno' };
    const kernelsToDispose: IKernel[] = [];
    const notebook = createMockedNotebookDocument([], { kernelspec: denoKernelSpec });
    let controller: IVSCodeNotebookController;
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
        controller = await getControllerForKernelSpec(30_000, { language: 'typescript', name: 'deno' });
        sinon
            .stub(ServiceContainer.instance.get<IVSCodeNotebook>(IVSCodeNotebook), 'notebookDocuments')
            .get(() => [notebook]);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        sinon.restore();
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await Promise.all(kernelsToDispose.map((p) => p.dispose().catch(noop)));
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));
    testMandatory('Get Kernel and execute code', async function () {
        const realKernel = kernelProvider.getOrCreate(notebook, {
            controller: controller.controller,
            metadata: controller.connection,
            resourceUri: notebook.uri
        });
        kernelsToDispose.push(realKernel);
        await realKernel.start();
        const kernel = getKernelsApi().findKernel({ uri: notebook.uri });
        if (!kernel) {
            throw new Error('Kernel not found');
        }
        const statusChange = createEventHandler(kernel, 'onDidChangeStatus', disposables);

        // Verify we can execute code using the kernel.
        traceInfo(`Execute code silently`);
        const expectedMime = NotebookCellOutputItem.stdout('').mime;
        const token = new CancellationTokenSource();
        await waitForOutput(kernel.executeCode('console.log(1234)', token.token), '1234', expectedMime);
        traceInfo(`Execute code silently completed`);
        // Wait for kernel to be idle.
        await waitForCondition(
            () => kernel.status === 'idle',
            5_000,
            `Kernel did not become idle, current status is ${kernel.status}`
        );

        // Verify state transition.
        assert.deepEqual(Array.from(new Set(statusChange.all)), ['busy', 'idle'], 'State transition is incorrect');

        // Verify we can execute code using the kernel in parallel.
        await Promise.all([
            waitForOutput(kernel.executeCode('console.log(1)', token.token), '1', expectedMime),
            waitForOutput(kernel.executeCode('console.log(2)', token.token), '2', expectedMime),
            waitForOutput(kernel.executeCode('console.log(3)', token.token), '3', expectedMime)
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
        const outputPromise = new Promise<void>((resolve, reject) => {
            executionResult.onDidEmitOutput(
                (e) => {
                    traceInfo(`Output received ${e.length} & mime types are ${e.map((item) => item.mime).join(', ')}}`);
                    e.forEach((item) => {
                        if (item.mime === expectedMimetype) {
                            const output = new TextDecoder().decode(item.data).trim();
                            if (output === expectedOutput) {
                                resolve();
                            } else {
                                reject(new Error(`Unexpected output ${output}`));
                            }
                        } else {
                            reject(new Error(`Unexpected output ${item.mime}`));
                        }
                    });
                },
                undefined,
                disposables
            );
        });

        await raceTimeoutError(30_000, new Error('Timed out waiting for output'), outputPromise).finally(() =>
            dispose(disposables)
        );
    }
});
