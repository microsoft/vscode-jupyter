// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, Uri, workspace } from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfoIfCI, traceInfo } from '../../../platform/logging';
import { captureScreenShot, IExtensionTestApi, initialize, waitForCondition } from '../../common';
import { openNotebook } from '../helpers';
import { closeNotebooksAndCleanUpAfterTests, hijackPrompt } from './helper';
import {
    createEmptyPythonNotebook,
    createTemporaryNotebook,
    defaultNotebookTestTimeout,
    insertCodeCell,
    runAllCellsInActiveNotebook,
    runCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    waitForTextOutput
} from './helper.node';
import { IServiceContainer } from '../../../platform/ioc/types';
import { IDisposable } from '../../../platform/common/types';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { IControllerRegistration } from '../../../notebooks/controllers/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';

suite('Remote Kernel Execution', function () {
    let controllerRegistration: IControllerRegistration;
    let vscodeNotebook: IVSCodeNotebook;
    let ipynbFile: Uri;
    let svcContainer: IServiceContainer;
    let interpreterService: IInterpreterService;

    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];

    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        await startJupyterServer();
        sinon.restore();
        const serviceContainer = api.serviceContainer;
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        vscodeNotebook = serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        svcContainer = serviceContainer;
        interpreterService = await api.serviceContainer.get<IInterpreterService>(IInterpreterService);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        if (!this.currentTest?.title.includes('preferred')) {
            await startJupyterServer();
        }
        // Don't use same file for this test (files get modified in tests and we might save stuff)
        ipynbFile = await createTemporaryNotebook(
            [
                {
                    cell_type: 'code',
                    source: ['a = "Hello World"\n'],
                    outputs: [],
                    execution_count: 0,
                    metadata: {}
                },
                {
                    cell_type: 'code',
                    source: ['print(a)\n'],
                    outputs: [],
                    execution_count: 0,
                    metadata: {}
                }
            ],
            disposables
        );
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
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Local Kernel state is not lost when connecting to remote @kernelPicker', async function () {
        const activeInterpreter = await interpreterService.getActiveInterpreter();
        traceInfoIfCI(`active interpreter ${activeInterpreter?.uri.path}`);
        const { notebook } = await createEmptyPythonNotebook(disposables);
        const controllerManager = svcContainer.get<IControllerRegistration>(IControllerRegistration);
        const preferredController = controllerManager.getSelected(notebook);
        traceInfoIfCI(`preferred controller ${preferredController?.connection.id}`);

        await insertCodeCell('a = "123412341234"', { index: 0 });
        await insertCodeCell('print(a)', { index: 1 });
        const cell1 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        const cell2 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(1)!;
        await runCell(cell1);

        // Now connect to a remote jupyter server.
        await startJupyterServer();

        // Verify we have a remote kernel spec.
        await waitForCondition(
            async () => {
                const controllers = controllerRegistration.registered;
                traceInfoIfCI(`Check ${controllers.length} registered controllers`);
                traceInfoIfCI(
                    `list controllers ${controllers.length}: ${controllers
                        .map((i) => `${i.connection.id}, ${i.connection.kind}`)
                        .join('\n')}`
                );
                return controllers.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec');
            },
            defaultNotebookTestTimeout,
            'Should have at least one remote controller'
        );

        const newPreferredController = controllerManager.getSelected(notebook);
        traceInfoIfCI(`new preferred controller ${newPreferredController?.connection.id}`);

        // Run the second cell and verify we still have the same kernel state.
        await Promise.all([runCell(cell2), waitForTextOutput(cell2, '123412341234')]);
    });

    test('Remote kernels support intellisense @lsp', async function () {
        const { editor } = await openNotebook(ipynbFile);
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE);
        let nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');
        // Cell 1 = `a = "Hello World"`
        // Cell 2 = `print(a)`
        let cell2 = nbEditor.notebook.getCells()![1]!;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell2),
            waitForTextOutput(cell2, 'Hello World', 0, false)
        ]);

        // Wait for tokens on the second cell (it works with just plain pylance)
        await waitForCondition(
            async () => {
                const promise = commands.executeCommand('vscode.provideDocumentSemanticTokens', cell2.document.uri);
                const result = (await promise) as any;
                return result && result.data.length > 0;
            },
            defaultNotebookTestTimeout,
            `Tokens never appear for first cell`,
            100,
            true
        );
    });

    test('Remote kernels work with https @kernelCore', async function () {
        // Note, this test won't work in web yet.
        const config = workspace.getConfiguration('jupyter');
        await config.update('allowUnauthorizedRemoteConnection', false);
        const prompt = await hijackPrompt(
            'showErrorMessage',
            { contains: 'certificate' },
            { result: DataScience.jupyterSelfCertEnable, clickImmediately: true }
        );
        await startJupyterServer(undefined, true);

        await waitForCondition(
            async () => {
                const controllers = controllerRegistration.registered;
                return controllers.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec');
            },
            defaultNotebookTestTimeout,
            'Should have at least one remote controller'
        );

        const { editor } = await openNotebook(ipynbFile);
        await waitForCondition(() => prompt.displayed, defaultNotebookTestTimeout, 'Prompt not displayed');
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE, true);
        let nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');
        // Cell 1 = `a = "Hello World"`
        // Cell 2 = `print(a)`
        let cell2 = nbEditor.notebook.getCells()![1]!;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell2),
            waitForTextOutput(cell2, 'Hello World', 0, false)
        ]);
    });
});
