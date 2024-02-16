// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { CancellationTokenSource, NotebookCellOutputItem, NotebookDocument, commands, window, workspace } from 'vscode';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import {
    captureScreenShot,
    createEventHandler,
    initialize,
    suiteMandatory,
    testMandatory,
    waitForCondition
} from '../../../test/common';
import {
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    getDefaultKernelConnection,
    insertCodeCell,
    runCell,
    waitForExecutionCompletedSuccessfully
} from '../../../test/datascience/notebook/helper';
import { getKernelsApi } from '.';
import { raceTimeoutError } from '../../../platform/common/utils/async';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IKernel, IKernelProvider } from '../../../kernels/types';
import { IControllerRegistration, IVSCodeNotebookController } from '../../../notebooks/controllers/types';
import { Kernels, Output } from '../../../api';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../../test/constants';
import { KernelError } from '../../../kernels/errors/kernelError';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { escapeStringToEmbedInPythonCode } from '../../../kernels/chat/generator';

suiteMandatory('Kernel API Tests @typescript', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    let kernelProvider: IKernelProvider;
    let notebook: NotebookDocument;
    let controller: IVSCodeNotebookController;
    let realKernel: IKernel;
    let kernels: Kernels;
    let controllerRegistration: IControllerRegistration;
    suiteSetup(async function () {
        this.timeout(120_000);
        traceInfo('Suite Setup, Step 1');
        const api = await initialize();
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        kernels = await Promise.resolve(getKernelsApi(JVSC_EXTENSION_ID_FOR_TESTS));
        // Wait till deno kernel has been discovered.
        const connection = await waitForCondition(
            async () =>
                controllerRegistration.all.find(
                    (k) => k.kind === 'startUsingLocalKernelSpec' && k.kernelSpec.language === 'typescript'
                )!,
            15_000,
            'Deno kernel not found'
        );
        controller = controllerRegistration.get(connection, 'jupyter-notebook')!;
        traceInfo('Suite Setup (completed)');
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        const uri = await createTemporaryNotebook(
            [],
            disposables,
            { name: 'deno', display_name: 'Deno' },
            undefined,
            undefined,
            'typescript'
        );
        notebook = await workspace.openNotebookDocument(uri);
        await window.showNotebookDocument(notebook);
        await commands.executeCommand('notebook.selectKernel', {
            id: controller!.id,
            extension: JVSC_EXTENSION_ID
        });
        await insertCodeCell('console.log(1234)', { index: 0, language: 'typescript' });
        realKernel = kernelProvider.getOrCreate(notebook, {
            controller: controller.controller,
            metadata: controller.connection,
            resourceUri: notebook.uri
        });
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }

        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    testMandatory('No kernel returned if no code has been executed', async function () {
        const kernel = await kernels.getKernel(notebook.uri);

        assert.isUndefined(kernel, 'Kernel should not be returned as no code was executed');
    });
    testMandatory('Get Kernel and execute code', async function () {
        // No kernel unless we execute code against this kernel.
        assert.isUndefined(await kernels.getKernel(notebook.uri));

        // Even after starting a kernel the API should not return anything,
        // as no code has been executed against this kernel.
        await realKernel.start();
        assert.isUndefined(await kernels.getKernel(notebook.uri));

        // Ensure user has executed some code against this kernel.
        const cell = notebook.cellAt(0)!;
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);

        const kernel = await kernels.getKernel(notebook.uri);
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
        assert.deepEqual(Array.from(new Set(statusChange.all)), ['busy', 'idle'], 'States are incorrect');

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

        // When we execute code that fails, we should get the error information.
        const errorOutputs: Output[] = [];
        let exceptionThrown = false;
        try {
            for await (const output of kernel.executeCode('Kaboom', token.token)) {
                errorOutputs.push(output);
            }
        } catch (ex) {
            exceptionThrown = true;
            assert.instanceOf(ex, KernelError, 'Error thrown is not a kernel error');
        }
        assert.isTrue(exceptionThrown, 'Kernel Execution should fail with an error');
        assert.strictEqual(errorOutputs.length, 1, 'Incorrect number of outputs');
        assert.strictEqual(errorOutputs[0].items.length, 1, 'Incorrect number of output items');
        assert.strictEqual(
            errorOutputs[0].items[0].mime,
            NotebookCellOutputItem.error(new Error('')).mime,
            'Expected an error output'
        );
        const error = JSON.parse(new TextDecoder().decode(errorOutputs[0].items[0].data));
        assert.include(error.message, 'Kaboom');
        assert.isOk(errorOutputs[0].metadata, 'No error metadata found');
        assert.isArray(errorOutputs[0].metadata?.originalError?.traceback, 'No traceback found in original error');
        assert.include(
            errorOutputs[0].metadata?.originalError?.traceback?.join(''),
            'Kaboom',
            'Traceback does not contain original error'
        );
    });

    async function waitForOutput(
        executionResult: AsyncIterable<Output>,
        expectedOutput: string,
        expectedMimetype: string
    ) {
        const disposables: IDisposable[] = [];
        const outputsReceived: string[] = [];
        const outputPromise = new Promise<void>(async (resolve, reject) => {
            for await (const output of executionResult) {
                output.items.forEach((item) => {
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
            }
        });

        await raceTimeoutError(
            30_000,
            new Error(`Timed out waiting for output, got ${outputsReceived}`),
            outputPromise
        ).finally(() => dispose(disposables));
    }
});

suiteMandatory('Kernel API Tests @typescript/@python', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    let notebook: NotebookDocument;
    let controller: IVSCodeNotebookController;
    let kernels: Kernels;
    let controllerRegistration: IControllerRegistration;
    suiteSetup(async function () {
        this.timeout(120_000);
        traceInfo('Suite Setup, Step 1');
        const api = await initialize();
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        kernels = await Promise.resolve(getKernelsApi(JVSC_EXTENSION_ID_FOR_TESTS));
        const pythonMetadata = await getDefaultKernelConnection();
        controller = controllerRegistration.get(pythonMetadata, 'jupyter-notebook')!;
        traceInfo('Suite Setup (completed)');
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        const uri = await createTemporaryNotebook([], disposables);
        notebook = await workspace.openNotebookDocument(uri);
        await window.showNotebookDocument(notebook);
        await commands.executeCommand('notebook.selectKernel', {
            id: controller!.id,
            extension: JVSC_EXTENSION_ID
        });
        await insertCodeCell('print(1234)', { index: 0, language: 'python' });
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }

        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    testMandatory('Execute chat code', async function () {
        // Ensure user has executed some code against this kernel.
        const cell = notebook.cellAt(0)!;
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);

        const kernel = await kernels.getKernel(notebook.uri);
        if (!kernel) {
            throw new Error('Kernel not found');
        }

        const text = ` Hello There\nNewLine\r\nAnotherNewLine\t containing spaces & \t tabs and oh yes even \b back spaces and lots of single ' quotes's and also " double quotes with \ back slashes \\ and more \\\\. \\\ `;
        const mime = 'application/vnd.custom.extension.message';
        const pythonCode = `
from vscode import chat
data_from_last_callback = None
def step1():
    chat.call_function("callback1", step2)

def step2(data):
    chat.call_function("callback2", step3, data)

def step3(data):
    chat.call_function("callback3", step4, "${escapeStringToEmbedInPythonCode(text)}")

def step4(data):
    import IPython.display
    display({"application/vnd.custom.extension.message": {"status":"ok", "output": data}}, raw=True)

step1()
`;
        // Verify we can execute code using the kernel.
        const callbacksInvoked: string[] = [];
        const callbackArgs: (string | undefined)[] = [];
        traceInfo(`Execute code`);
        const token = new CancellationTokenSource();
        const handlers = {
            callback1: async (data?: string) => {
                callbacksInvoked.push('callback1');
                callbackArgs.push(data);
                return data;
            },
            callback2: async (data?: string) => {
                callbacksInvoked.push('callback2');
                callbackArgs.push(data);
                return data;
            },
            callback3: async (data?: string) => {
                callbacksInvoked.push('callback3');
                callbackArgs.push(data);
                return data;
            }
        };
        type Result = {
            status: string;
            output: string;
        };
        let result: Result | undefined = undefined;
        let resultsReturned = '';
        for await (const output of kernel.executeChatCode(pythonCode, handlers, token.token)) {
            const item = output.items.find((i) => i.mime === mime);
            if (item) {
                result = JSON.parse(new TextDecoder().decode(item.data));
                break;
            } else {
                output.items.forEach((i) => {
                    resultsReturned += `Output ${i.mime} ${new TextDecoder().decode(i.data)}\n`;
                });
            }
        }

        assert.isOk(result, `No result returned, returned items include ${resultsReturned}`);
        assert.strictEqual(result!.status, 'ok', 'Status is not ok');
        assert.strictEqual(result!.output, text, 'Final result is not right');
        assert.deepEqual(callbacksInvoked, ['callback1', 'callback2', 'callback3'], 'Not all callbacks invoked');
        assert.deepEqual(
            callbackArgs,
            [undefined, undefined, text],
            'Not all callbacks invoked with the right arguments'
        );
    });
});
