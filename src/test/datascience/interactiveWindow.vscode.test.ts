// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as vscode from 'vscode';
import { getDisplayPath, getFilePath } from '../../platform/common/platform/fs-paths';
import { IExtensionTestApi } from '../common.node';
import { IS_REMOTE_NATIVE_TEST, IS_CONDA_TEST } from '../initialize.node';
import {
    closeInteractiveWindow,
    installIPyKernel,
    runCurrentFile,
    runNewPythonFile,
    setActiveInterpreter,
    uninstallIPyKernel,
    waitForLastCellToComplete
} from './helpers.node';
import { startJupyterServer } from './notebook/helper.node';
import { INotebookControllerManager } from '../../notebooks/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { areInterpreterPathsSame } from '../../platform/pythonEnvironments/info/interpreter';
import { IPythonApiProvider } from '../../platform/api/types';
import { isEqual } from '../../platform/vscode-path/resources';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { DebuggerType, sharedInterActiveWindowTests } from './interactiveWindow.vscode.common';
import { IInteractiveWindowProvider } from '../../interactive-window/types';

const debuggerTypes: DebuggerType[] = ['JupyterProtocolDebugger', 'VSCodePythonDebugger'];
debuggerTypes.forEach((debuggerType) => {
    suite(`Interactive window tests for debugger type ${debuggerType}`, async function () {
        let venNoKernelPath: vscode.Uri;
        let venvKernelPath: vscode.Uri;
        let pythonApiProvider: IPythonApiProvider;
        let originalActiveInterpreter: PythonEnvironment | undefined;
        let api: IExtensionTestApi;
        let interactiveWindowProvider: IInteractiveWindowProvider;

        let disposables = sharedInterActiveWindowTests(
            this,
            debuggerType,
            (n) => {
                return startJupyterServer(n);
            },
            async (initializedApi: IExtensionTestApi) => {
                api = initializedApi;
                pythonApiProvider = api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider);
                interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
            }
        );

        async function preSwitch() {
            const pythonApi = await pythonApiProvider.getApi();
            await pythonApi.refreshInterpreters({ clearCache: true });
            const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
            const interpreters = await interpreterService.getInterpreters();
            const venvNoKernelInterpreter = interpreters.find((i) => getFilePath(i.uri).includes('.venvnokernel'));
            const venvKernelInterpreter = interpreters.find((i) => getFilePath(i.uri).includes('.venvkernel'));

            if (!venvNoKernelInterpreter || !venvKernelInterpreter) {
                throw new Error(
                    `Unable to find matching kernels. List of kernels is ${interpreters
                        .map((i) => getFilePath(i.uri))
                        .join('\n')}`
                );
            }
            venNoKernelPath = venvNoKernelInterpreter.uri;
            venvKernelPath = venvKernelInterpreter.uri;
            originalActiveInterpreter = await interpreterService.getActiveInterpreter();

            // No kernel should not have ipykernel in it yet, but we need two, so install it.
            await installIPyKernel(venNoKernelPath.fsPath);
            assert.ok(originalActiveInterpreter, `No active interpreter when running switch test`);
        }
        async function postSwitch() {
            await uninstallIPyKernel(venNoKernelPath.fsPath);
            await setActiveInterpreter(pythonApiProvider, undefined, originalActiveInterpreter?.uri);
        }

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
                const notebookControllerManager =
                    api.serviceManager.get<INotebookControllerManager>(INotebookControllerManager);
                // Ensure we picked up the active interpreter for use as the kernel

                let controller = notebookDocument
                    ? notebookControllerManager.getSelectedNotebookController(notebookDocument)
                    : undefined;
                assert.ok(
                    areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                    `Controller does not match active interpreter for ${getDisplayPath(
                        notebookDocument?.uri
                    )} - active: ${activeInterpreter?.uri} controller: ${controller?.connection.interpreter?.uri}`
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
                controller = notebookDocument
                    ? notebookControllerManager.getSelectedNotebookController(notebookDocument)
                    : undefined;

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
    });
});
