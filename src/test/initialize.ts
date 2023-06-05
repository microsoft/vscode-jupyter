// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { clearPendingChainedUpdatesForTests } from '../kernels/execution/notebookUpdater';
import { IExtensionApi } from '../standalone/api/api';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable } from '../platform/common/types';
import { sleep } from '../platform/common/utils/async.core';
import { clearPendingTimers, IExtensionTestApi } from './common';
import { IS_SMOKE_TEST, JVSC_EXTENSION_ID_FOR_TESTS } from './constants';
import { noop } from './core';

export function isInsiders() {
    return vscode.env.appName.indexOf('Insider') > 0 || vscode.env.appName.indexOf('OSS') > 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initialize(): Promise<IExtensionTestApi> {
    const api = await activateExtension();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return api as any as IExtensionTestApi;
}

export async function activateExtension() {
    const extension = vscode.extensions.getExtension<IExtensionApi>(JVSC_EXTENSION_ID_FOR_TESTS)!;
    const api = await extension.activate();
    // Wait until its ready to use.
    await api.ready;
    return api;
}

export async function closeActiveWindows(disposables: IDisposable[] = []): Promise<void> {
    if (!IS_SMOKE_TEST()) {
        clearPendingChainedUpdatesForTests();
    }
    clearPendingTimers();
    disposeAllDisposables(disposables);
    await closeWindowsAndNotebooks();
}
async function closeWindowsAndNotebooks(): Promise<void> {
    if (!isInsiders() || !isANotebookOpen()) {
        await closeWindowsInternal();
        return;
    }
    // We could have untitled notebooks, close them by reverting changes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    while (vscode.window.activeNotebookEditor || vscode.window.activeTextEditor) {
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
    // Work around VS Code issues (sometimes notebooks do not get closed).
    // Hence keep trying.
    for (let counter = 0; counter <= 5 && isANotebookOpen(); counter += 1) {
        await sleep(counter * 10);
        await closeWindowsInternal();
    }
}

async function closeWindowsInternal() {
    // If there are no editors, we can skip. This seems to time out if no editors visible.
    if (!vscode.window.visibleTextEditors || !isANotebookOpen()) {
        // Instead just post the command
        vscode.commands.executeCommand('workbench.action.closeAllEditors').then(noop, noop);
        return;
    }

    class CloseEditorsTimeoutError extends Error {
        constructor() {
            super("Command 'workbench.action.closeAllEditors' timed out");
        }
    }
    const closeWindowsImplementation = (timeout = 1_000) => {
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
    if (!isInsiders()) {
        return false;
    }
    /* eslint-disable */
    if (Array.isArray(vscode.window.visibleNotebookEditors) && vscode.window.visibleNotebookEditors.length) {
        return true;
    }
    return !!vscode.window.activeNotebookEditor;
}
