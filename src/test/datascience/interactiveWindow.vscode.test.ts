// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { traceInfo } from '../../platform/logging';
import { getDisplayPath, getFilePath } from '../../platform/common/platform/fs-paths';
import { IDisposable } from '../../platform/common/types';
import { InteractiveWindowProvider } from '../../interactive-window/interactiveWindowProvider';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../common.node';
import { initialize, IS_REMOTE_NATIVE_TEST, IS_CONDA_TEST } from '../initialize.node';
import {
    closeInteractiveWindow,
    createStandaloneInteractiveWindow,
    installIPyKernel,
    runCurrentFile,
    runNewPythonFile,
    setActiveInterpreter,
    uninstallIPyKernel,
    waitForInteractiveWindow,
    waitForLastCellToComplete,
    runInteractiveWindowInput
} from './helpers.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    defaultNotebookTestTimeout,
    generateTemporaryFilePath,
    hijackPrompt,
    hijackSavePrompt,
    startJupyterServer,
    waitForTextOutput,
    WindowPromptStubButtonClickOptions
} from './notebook/helper.node';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { areInterpreterPathsSame } from '../../platform/pythonEnvironments/info/interpreter';
import { IPythonApiProvider } from '../../platform/api/types';
import { isEqual } from '../../platform/vscode-path/resources';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { Commands } from '../../platform/common/constants';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { getCachedEnvironments } from '../../platform/interpreter/helpers';

suite(`Interactive window Execution @iw`, async function () {
    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let interactiveWindowProvider: InteractiveWindowProvider;
    let venNoKernelPath: vscode.Uri;
    let venvKernelPath: vscode.Uri;
    let pythonApiProvider: IPythonApiProvider;
    let originalActiveInterpreter: PythonEnvironment | undefined;
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST()) {
            await startJupyterServer();
        }
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
        pythonApiProvider = api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await vscode.commands.executeCommand('python.clearWorkspaceInterpreter');
        if (this.currentTest?.isFailed()) {
            // For a flaky interrupt test.
            await captureScreenShot(this);
        }
        sinon.restore();
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    async function preSwitch() {
        const pythonApi = await pythonApiProvider.getNewApi();
        await pythonApi?.environments.refreshEnvironments({ forceRefresh: true });
        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        await waitForCondition(
            () => {
                const venvNoKernelInterpreter = getCachedEnvironments().find((i) =>
                    getFilePath(i.executable.uri).includes('.venvnokernel')
                );
                const venvKernelInterpreter = getCachedEnvironments().find((i) =>
                    getFilePath(i.executable.uri).includes('.venvkernel')
                );
                return venvNoKernelInterpreter && venvKernelInterpreter ? true : false;
            },
            defaultNotebookTestTimeout,
            'Waiting for interpreters to be discovered'
        );
        const venvNoKernelInterpreter = getCachedEnvironments().find((i) =>
            getFilePath(i.executable.uri).includes('.venvnokernel')
        );
        const venvKernelInterpreter = getCachedEnvironments().find((i) =>
            getFilePath(i.executable.uri).includes('.venvkernel')
        );

        if (!venvNoKernelInterpreter || !venvKernelInterpreter) {
            throw new Error(
                `Unable to find matching kernels. List of kernels is ${getCachedEnvironments()
                    .map((i) => getFilePath(i.executable.uri))
                    .join('\n')}`
            );
        }
        venNoKernelPath = venvNoKernelInterpreter.executable.uri!;
        venvKernelPath = venvKernelInterpreter.executable.uri!;
        originalActiveInterpreter = await interpreterService.getActiveInterpreter();

        // No kernel should not have ipykernel in it yet, but we need two, so install it.
        await installIPyKernel(venNoKernelPath.fsPath);
        assert.ok(originalActiveInterpreter, `No active interpreter when running switch test`);
    }
    async function postSwitch() {
        await uninstallIPyKernel(venNoKernelPath.fsPath);
        await setActiveInterpreter(pythonApiProvider, undefined, originalActiveInterpreter?.uri);
        await vscode.commands.executeCommand('python.clearWorkspaceInterpreter');
    }

    test('Export Interactive window to Notebook', async () => {
        const activeInteractiveWindow = await createStandaloneInteractiveWindow(interactiveWindowProvider);
        await waitForInteractiveWindow(activeInteractiveWindow);

        // Add a few cells from the input box
        await runInteractiveWindowInput('print("first")', activeInteractiveWindow, 1);
        await runInteractiveWindowInput('print("second")', activeInteractiveWindow, 2);
        await runInteractiveWindowInput('print("third")', activeInteractiveWindow, 3);

        await waitForLastCellToComplete(activeInteractiveWindow, 3, false);
        let notebookFile = await generateTemporaryFilePath('ipynb', disposables);
        const promptOptions: WindowPromptStubButtonClickOptions = {
            result: notebookFile,
            clickImmediately: true
        };
        let savePrompt = await hijackSavePrompt('Export', promptOptions, disposables);
        let openFilePrompt = await hijackPrompt(
            'showInformationMessage',
            { contains: 'Notebook written to' },
            { dismissPrompt: false },
            disposables
        );

        await vscode.commands.executeCommand(Commands.InteractiveExportAsNotebook, activeInteractiveWindow.notebookUri);

        await waitForCondition(() => savePrompt.displayed, defaultNotebookTestTimeout, 'save Prompt not displayed');
        await waitForCondition(
            () => openFilePrompt.displayed,
            defaultNotebookTestTimeout,
            'open file Prompt not displayed'
        );

        const document = await vscode.workspace.openNotebookDocument(notebookFile);
        let editor = await vscode.window.showNotebookDocument(document, { preserveFocus: false });

        const cells = editor.notebook.getCells();
        assert.strictEqual(cells?.length, 3);
        await waitForTextOutput(cells[0], 'first');
    });

    test('Switching active interpreter on a python file changes kernel in use', async function () {
        // Virtual environments are not available in conda
        if (IS_CONDA_TEST() || IS_REMOTE_NATIVE_TEST()) {
            this.skip();
        }
        await preSwitch();

        try {
            const interpreterService = await api.serviceManager.get<IInterpreterService>(IInterpreterService);
            const activeInterpreter = await interpreterService.getActiveInterpreter();
            const { activeInteractiveWindow, untitledPythonFile } = await runNewPythonFile(
                interactiveWindowProvider,
                'import sys\nprint(sys.executable)',
                disposables
            );
            await waitForLastCellToComplete(activeInteractiveWindow, 1, true);
            let notebookDocument = vscode.workspace.notebookDocuments.find(
                (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
            )!;
            const notebookControllerManager = api.serviceManager.get<IControllerRegistration>(IControllerRegistration);
            // Ensure we picked up the active interpreter for use as the kernel

            let controller = notebookDocument ? notebookControllerManager.getSelected(notebookDocument) : undefined;
            assert.ok(
                areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                `Controller does not match active interpreter for ${getDisplayPath(
                    notebookDocument?.uri
                )} - active: ${activeInterpreter?.uri} controller: ${getDisplayPath(
                    controller?.connection?.interpreter?.uri
                )}`
            );

            // Now switch the active interpreter to the other path
            if (isEqual(activeInterpreter?.uri, venNoKernelPath)) {
                await setActiveInterpreter(pythonApiProvider, untitledPythonFile.uri, venvKernelPath);
            } else {
                await setActiveInterpreter(pythonApiProvider, untitledPythonFile.uri, venNoKernelPath);
            }

            // Close the interactive window and recreate it
            await closeInteractiveWindow(activeInteractiveWindow);

            // Run again and make sure it uses the new interpreter
            const newIW = await runCurrentFile(interactiveWindowProvider, untitledPythonFile);
            await waitForLastCellToComplete(newIW, 1, true);

            // Make sure it's a new window
            assert.notEqual(newIW, activeInteractiveWindow, `New IW was not created`);

            // Get the controller
            notebookDocument = vscode.workspace.notebookDocuments.find(
                (doc) => doc.uri.toString() === newIW?.notebookUri?.toString()
            )!;
            controller = notebookDocument ? notebookControllerManager.getSelected(notebookDocument) : undefined;

            // Controller path should not be the same as the old active interpreter
            assert.isFalse(
                areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                `Controller should not match active interpreter for ${getDisplayPath(
                    notebookDocument?.uri
                )} after changing active interpreter`
            );
        } finally {
            await postSwitch();
        }
    });

    // todo@joyceerhl
    // test('Verify CWD', () => { });
    // test('Multiple executes go to last active window', async () => { });
    // test('Per file', async () => { });
    // test('Per file asks and changes titles', async () => { });
    // test('Debug cell with leading newlines', () => { });
    // test('Debug cell with multiple function definitions', () => { });
    // test('Should skip empty cells from #%% file or input box', () => { });
    // test('Export', () => { });
});
