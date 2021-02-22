import * as path from 'path';
import * as vscode from 'vscode';
import type { IExtensionApi } from '../client/api';
import { disposeAllDisposables } from '../client/common/helpers';
import type { IDisposable } from '../client/common/types';
import { clearPendingChainedUpdatesForTests } from '../client/datascience/notebook/helpers/notebookUpdater';
import { clearPendingTimers, IExtensionTestApi, PYTHON_PATH, setPythonPathInWorkspaceRoot } from './common';
import { IS_SMOKE_TEST, JVSC_EXTENSION_ID_FOR_TESTS } from './constants';
import { sleep } from './core';
import { startJupyterServer } from './datascience/notebook/helper';

export * from './constants';
export * from './ciConstants';
export const multirootPath = path.join(__dirname, '..', '..', 'src', 'testMultiRootWkspc');

//First thing to be executed.
process.env.VSC_JUPYTER_CI_TEST = '1';

// Ability to use custom python environments for testing
export async function initializePython() {
    await setPythonPathInWorkspaceRoot(PYTHON_PATH);
}

export function isInsiders() {
    return vscode.env.appName.indexOf('Insider') > 0 || vscode.env.appName.indexOf('OSS') > 0;
}

let jupyterServerStarted = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initialize(): Promise<IExtensionTestApi> {
    await initializePython();
    const api = await activateExtension();
    // Ensure we start jupyter server before opening any notebooks or the like.
    if (!jupyterServerStarted) {
        jupyterServerStarted = true;
        await startJupyterServer((api as unknown) as IExtensionTestApi);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (api as any) as IExtensionTestApi;
}

export async function activateExtension() {
    const extension = vscode.extensions.getExtension<IExtensionApi>(JVSC_EXTENSION_ID_FOR_TESTS)!;
    const api = await extension.activate();
    // Wait until its ready to use.
    await api.ready;
    return api;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initializeTest(): Promise<any> {
    await initializePython();
    await closeActiveWindows();
    if (!IS_SMOKE_TEST) {
        // When running smoke tests, we won't have access to these.
        const configSettings = await import('../client/common/configSettings');
        // Dispose any cached python settings (used only in test env).
        configSettings.JupyterSettings.dispose();
    }
}
export async function closeActiveWindows(disposables: IDisposable[] = []): Promise<void> {
    if (isInsiders() && process.env.VSC_JUPYTER_RUN_NB_TEST) {
        clearPendingChainedUpdatesForTests();
    }
    clearPendingTimers();
    disposeAllDisposables(disposables);
    await closeActiveNotebooks();
    await closeWindowsInternal();
}
export async function closeActiveNotebooks(): Promise<void> {
    if (!vscode.env.appName.toLowerCase().includes('insiders') || !isANotebookOpen()) {
        return;
    }
    // We could have untitled notebooks, close them by reverting changes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    while ((vscode as any).notebook.activeNotebookEditor || vscode.window.activeTextEditor) {
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
    // Work around VS Code issues (sometimes notebooks do not get closed).
    // Hence keep trying.
    for (let counter = 0; counter <= 5 && isANotebookOpen(); counter += 1) {
        await sleep(counter * 100);
        await closeWindowsInternal();
    }
}

async function closeWindowsInternal() {
    // If there are no editors, we can skip. This seems to time out if no editors visible.
    if (
        !vscode.window.visibleTextEditors ||
        (vscode.env.appName.toLowerCase().includes('insiders') && !vscode.window.visibleNotebookEditors)
    ) {
        // Instead just post the command
        void vscode.commands.executeCommand('workbench.action.closeAllEditors');
        return;
    }

    class CloseEditorsTimeoutError extends Error {
        constructor() {
            super("Command 'workbench.action.closeAllEditors' timed out");
        }
    }
    const closeWindowsImplementation = (timeout = 2_000) => {
        return new Promise<void>((resolve, reject) => {
            // Attempt to fix #1301.
            // Lets not waste too much time.
            const timer = setTimeout(() => reject(new CloseEditorsTimeoutError()), timeout);
            vscode.commands.executeCommand('workbench.action.closeAllEditors').then(
                () => {
                    clearTimeout(timer);
                    resolve();
                },
                (ex) => {
                    clearTimeout(timer);
                    reject(ex);
                }
            );
        });
    };

    // For some reason some times the command times out.
    // If this happens, just wait & retry, no idea why VS Code is flaky.
    // Lets wait & retry executing the command again, hopefully it'll work second time.
    try {
        await closeWindowsImplementation();
    } catch (ex) {
        if (ex instanceof CloseEditorsTimeoutError) {
            // Do nothing. Just stop waiting.
        } else {
            throw ex;
        }
    }
}

function isANotebookOpen() {
    /* eslint-disable */
    if (
        Array.isArray((vscode as any).notebook.visibleNotebookEditors) &&
        (vscode as any).notebook.visibleNotebookEditors.length
    ) {
        return true;
    }
    return !!(vscode as any).notebook.activeNotebookEditor;
}
