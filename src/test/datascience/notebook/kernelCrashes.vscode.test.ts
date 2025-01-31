// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { DataScience } from '../../../platform/common/utils/localize';
import { logger } from '../../../platform/logging';
import { IConfigurationService, IDisposable, IExtensionContext } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common.node';
import { initialize } from '../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    startJupyterServer,
    hijackPrompt,
    waitForExecutionCompletedSuccessfully,
    defaultNotebookTestTimeout,
    getCellOutputs,
    getDefaultKernelConnection
} from './helper.node';
import { IS_NON_RAW_NATIVE_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import dedent from 'dedent';
import { IKernelProvider, KernelConnectionMetadata } from '../../../kernels/types';
import { createDeferred } from '../../../platform/common/utils/async';
import { noop, sleep } from '../../core';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { EventEmitter, NotebookCell, NotebookController, NotebookDocument, NotebookEditor, notebooks } from 'vscode';
import { JupyterNotebookView } from '../../../platform/common/constants';
import { TestNotebookDocument, createKernelController } from './executionHelper';
import { VSCodeNotebookController } from '../../../notebooks/controllers/vscodeNotebookController';
import { NotebookCellLanguageService } from '../../../notebooks/languages/cellLanguageService';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IJupyterServerProviderRegistry } from '../../../kernels/jupyter/types';
import { instance, mock, when } from 'ts-mockito';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { ConnectionDisplayDataProvider } from '../../../notebooks/controllers/connectionDisplayData.node';

const codeToKillKernel = dedent`
import IPython
app = IPython.Application.instance()
app.kernel.do_shutdown(True)
`;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('VSCode Notebook Kernel Error Handling - @kernelCore', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let kernelProvider: IKernelProvider;
    let notebook: TestNotebookDocument;
    const kernelCrashFailureMessageInCell =
        'The Kernel crashed while executing code in the current cell or a previous cell.';
    this.timeout(120_000);
    let kernelConnectionMetadata: KernelConnectionMetadata;
    // let kernel: IKernel;
    // let kernelExecution: INotebookKernelExecution;
    let interpreterController: VSCodeNotebookController;
    let cellExecutionHandler: (
        cells: NotebookCell[],
        notebook: NotebookDocument,
        controller: NotebookController
    ) => void | Thenable<void>;
    let controller: NotebookController;
    suiteSetup(async function () {
        logger.info('Suite Setup');
        this.timeout(120_000);
        try {
            api = await initialize();
            kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
            await startJupyterServer();
            sinon.restore();
            const context = api.serviceContainer.get<IExtensionContext>(IExtensionContext);
            const languageService = api.serviceContainer.get<NotebookCellLanguageService>(NotebookCellLanguageService);
            const configuration = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
            const extensionChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
            const providerRegitry =
                api.serviceContainer.get<IJupyterServerProviderRegistry>(IJupyterServerProviderRegistry);
            const platform = api.serviceContainer.get<IPlatformService>(IPlatformService);
            const interpreters = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
            kernelConnectionMetadata = await getDefaultKernelConnection();
            const displayDataProvider = new ConnectionDisplayDataProvider(
                platform,
                providerRegitry,
                disposables,
                interpreters
            );
            sinon.stub(notebooks, 'createNotebookController').callsFake((id, _view, _label, handler) => {
                cellExecutionHandler = handler!;
                const nbController = mock<NotebookController>();
                const onDidChangeSelectedNotebooks = new EventEmitter<{
                    readonly notebook: NotebookDocument;
                    readonly selected: boolean;
                }>();
                const onDidReceiveMessage = new EventEmitter<{
                    readonly editor: NotebookEditor;
                    readonly message: any;
                }>();

                disposables.push(onDidChangeSelectedNotebooks);
                disposables.push(onDidReceiveMessage);
                when(nbController.onDidChangeSelectedNotebooks).thenReturn(onDidChangeSelectedNotebooks.event);
                when(nbController.onDidReceiveMessage).thenReturn(onDidReceiveMessage.event);
                when(nbController.postMessage).thenReturn(noop as any);
                when(nbController.dispose).thenReturn(noop);
                when(nbController.updateNotebookAffinity).thenReturn(noop);
                when(nbController.asWebviewUri).thenCall((uri) => uri);
                when(nbController.createNotebookCellExecution).thenReturn(
                    createKernelController(id).createNotebookCellExecution
                );
                controller = instance(nbController);
                return controller;
            });

            interpreterController = new VSCodeNotebookController(
                kernelConnectionMetadata,
                kernelConnectionMetadata.id,
                JupyterNotebookView,
                kernelProvider,
                context,
                disposables,
                languageService,
                configuration,
                extensionChecker,
                api.serviceContainer,
                displayDataProvider
            );
            disposables.push(interpreterController);

            logger.info('Suite Setup (completed)');
        } catch (e) {
            await captureScreenShot('execution-suite');
            throw e;
        }
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        try {
            logger.info(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            await startJupyterServer();
            notebook = new TestNotebookDocument();
            logger.info(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this);
            throw e;
        }
    });
    teardown(async function () {
        logger.info(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        sinon.restore();
        logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => {
        sinon.restore();
        return closeNotebooksAndCleanUpAfterTests(disposables);
    });
    suite('Raw Kernels', () => {
        setup(function () {
            if (IS_REMOTE_NATIVE_TEST() || IS_NON_RAW_NATIVE_TEST()) {
                return this.skip();
            }
        });
        async function runAndFailWithKernelCrash() {
            const cell1 = await notebook.appendCodeCell('print("123412341234")');
            const cell2 = await notebook.appendCodeCell(codeToKillKernel);

            await Promise.all([
                cellExecutionHandler([cell1], notebook, controller),
                waitForExecutionCompletedSuccessfully(cell1)
            ]);
            const kernel = kernelProvider.get(notebook)!;
            const terminatingEventFired = createDeferred<boolean>();
            const deadEventFired = createDeferred<boolean>();
            const expectedErrorMessage = DataScience.kernelDiedWithoutError(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            );
            const prompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { dismissPrompt: true },
                disposables
            );

            kernel.onStatusChanged((status) => {
                if (status === 'terminating') {
                    terminatingEventFired.resolve();
                }
                if (status === 'dead') {
                    deadEventFired.resolve();
                }
            });
            // Run cell that will kill the kernel.
            await Promise.all([
                cellExecutionHandler([cell2], notebook, controller),
                waitForExecutionCompletedSuccessfully(cell2)
            ]);
            // Confirm we get the terminating & dead events.
            // Kernel must die immediately, lets just wait for 10s.
            await Promise.race([
                Promise.all([terminatingEventFired, deadEventFired, prompt.displayed]),
                sleep(10_000).then(() => Promise.reject(new Error('Did not fail')))
            ]);
            prompt.dispose();

            // Verify we have output in the cell to indicate the cell crashed.
            await waitForCondition(
                async () => {
                    const output = getCellOutputs(cell2);
                    return (
                        output.includes(kernelCrashFailureMessageInCell) &&
                        output.includes('https://aka.ms/vscodeJupyterKernelCrash')
                    );
                },
                defaultNotebookTestTimeout,
                () => `Cell did not have kernel crash output, the output is = ${getCellOutputs(cell2)}`
            );
        }
        test('Ensure we get an error displayed in cell output and prompt when user has a file named random.py next to the ipynb file', async function () {
            await runAndFailWithKernelCrash();
            const cell3 = await notebook.appendCodeCell('print("123412341234")');
            const kernel = kernelProvider.get(notebook)!;
            const expectedErrorMessage = DataScience.cannotRunCellKernelIsDead(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            );
            const restartPrompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { result: DataScience.restartKernel, clickImmediately: true },
                disposables
            );
            // Confirm we get a prompt to restart the kernel, and it gets restarted.
            // & also confirm the cell completes execution with an execution count of 1 (thats how we tell kernel restarted).
            await Promise.all([
                restartPrompt.displayed,
                cellExecutionHandler([cell3], notebook, controller),
                waitForExecutionCompletedSuccessfully(cell3)
            ]);
            // If execution order is 1, then we know the kernel restarted.
            assert.strictEqual(cell3.executionSummary?.executionOrder, 1);
        });
        test('Ensure cell output does not have errors when execution fails due to dead kernel', async function () {
            await runAndFailWithKernelCrash();
            const cell3 = await notebook.appendCodeCell('print("123412341234")');
            const kernel = kernelProvider.get(notebook)!;
            const expectedErrorMessage = DataScience.cannotRunCellKernelIsDead(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            );
            const restartPrompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { dismissPrompt: true, clickImmediately: true },
                disposables
            );
            // Confirm we get a prompt to restart the kernel, dismiss the prompt.
            await Promise.all([restartPrompt.displayed, cellExecutionHandler([cell3], notebook, controller)]);
            await sleep(1_000);
            assert.isUndefined(cell3.executionSummary?.executionOrder, 'Should not have an execution order');
        });
        test('Ensure we get only one prompt to restart kernel when running all cells against a dead kernel', async function () {
            await runAndFailWithKernelCrash();
            await notebook.appendCodeCell('print("123412341234")');
            const kernel = kernelProvider.get(notebook)!;
            const expectedErrorMessage = DataScience.cannotRunCellKernelIsDead(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            );
            const restartPrompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { dismissPrompt: true, clickImmediately: true },
                disposables
            );
            // Delete the killing cell
            notebook.cells.splice(1, 1);

            // Confirm we get a prompt to restart the kernel, dismiss the prompt.
            // Confirm the cell isn't executed & there's no output (in the past we'd have s stack trace with errors indicating session has been disposed).
            await Promise.all([restartPrompt.displayed, cellExecutionHandler(notebook.cells, notebook, controller)]);
            // Wait a while, it shouldn't take 1s, but things could be slow on CI, hence wait a bit longer.
            await sleep(1_000);

            assert.strictEqual(restartPrompt.getDisplayCount(), 1, 'Should only have one restart prompt');
        });
    });
});
