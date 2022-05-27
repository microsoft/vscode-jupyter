/* eslint-disable local-rules/dont-use-fspath */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IWorkspaceService } from '../../platform/common/application/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { IPlatformService } from '../../platform/common/platform/types';
import { IDisposable } from '../../platform/common/types';
import { swallowExceptions } from '../../platform/common/utils/misc';
import { traceInfo } from '../../platform/logging';
import * as urlPath from '../../platform/vscode-path/resources';
import * as uuid from 'uuid/v4';
import {
    defaultNotebookTestTimeout,
    getServices,
    waitForCellExecutionToComplete,
    waitForExecutionCompletedSuccessfully
} from './notebook/helper';
import { IInteractiveWindow, IInteractiveWindowProvider } from '../../interactive-window/types';
import { waitForCondition } from '../common';
import { sleep } from '../core';
import { InteractiveWindowProvider } from '../../interactive-window/interactiveWindowProvider';
import { Commands } from '../../platform/common/constants';
import { IDataScienceCodeLensProvider } from '../../interactive-window/editor-integration/types';

export async function openNotebook(ipynbFile: vscode.Uri) {
    traceInfo(`Opening notebook ${getFilePath(ipynbFile)}`);
    const nb = await vscode.workspace.openNotebookDocument(ipynbFile);
    await vscode.window.showNotebookDocument(nb);
    traceInfo(`Opened notebook ${getFilePath(ipynbFile)}`);
    return nb;
}

export async function createTemporaryPythonFile(contents: string, disposables: IDisposable[]) {
    const services = await getServices();
    const platformService = services.serviceContainer.get<IPlatformService>(IPlatformService);
    const workspaceService = services.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    const rootUrl =
        platformService.tempDir ||
        workspaceService.rootFolder ||
        vscode.Uri.file('./').with({ scheme: 'vscode-test-web' });
    const uri = urlPath.joinPath(rootUrl, `${uuid()}.py`);

    await vscode.workspace.fs.writeFile(uri, Buffer.from(contents));

    disposables.push({
        dispose: () => swallowExceptions(() => vscode.workspace.fs.delete(uri))
    });
    return uri;
}

export async function submitFromPythonFile(
    interactiveWindowProvider: IInteractiveWindowProvider,
    source: string,
    disposables: IDisposable[]
) {
    const tempFile = await createTemporaryPythonFile(source, disposables);
    const untitledPythonFile = await vscode.workspace.openTextDocument(tempFile);
    await vscode.window.showTextDocument(untitledPythonFile);
    await vscode.commands.executeCommand(Commands.RunFileInInteractiveWindows);
    let activeInteractiveWindow = interactiveWindowProvider.get(tempFile)!;
    await waitForActiveInteractiveWindow(interactiveWindowProvider, activeInteractiveWindow);
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function submitFromPythonFileUsingCodeWatcher(
    interactiveWindowProvider: IInteractiveWindowProvider,
    codeLensProvider: IDataScienceCodeLensProvider,
    source: string,
    disposables: vscode.Disposable[]
) {
    let { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile(
        interactiveWindowProvider,
        source,
        disposables
    );
    const codeWatcher = codeLensProvider.getCodeWatcher(untitledPythonFile);
    void codeWatcher?.runAllCells();
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function waitForActiveInteractiveWindow(
    iwProvider: IInteractiveWindowProvider,
    expectedInteractiveWindow?: IInteractiveWindow
): Promise<void> {
    await waitForCondition(
        () => {
            let activeWindow = iwProvider.getActiveInteractiveWindow();
            let isCorrectWindow =
                !!activeWindow && (!expectedInteractiveWindow || activeWindow === expectedInteractiveWindow);
            return isCorrectWindow && activeWindow?.notebookUri !== undefined;
        },
        defaultNotebookTestTimeout,
        'Interactive window did not become active'
    );
}

export async function createStandaloneInteractiveWindow(iwProvider: InteractiveWindowProvider) {
    let currentIW = iwProvider.getActiveInteractiveWindow();
    await vscode.commands.executeCommand(Commands.CreateNewInteractive);
    let activeInteractiveWindow: IInteractiveWindow | undefined;
    await waitForCondition(
        () => {
            activeInteractiveWindow = iwProvider.getActiveInteractiveWindow();
            return currentIW !== activeInteractiveWindow && activeInteractiveWindow?.notebookUri !== undefined;
        },
        defaultNotebookTestTimeout,
        'Interactive window did not become active'
    );

    return activeInteractiveWindow!;
}

export async function insertIntoInputEditor(source: string) {
    // Add code to the input box
    await vscode.window.activeTextEditor?.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(0, 0), source);
    });
    return vscode.window.activeTextEditor;
}

export async function runFileInInteractiveWindow(iwProvider: IInteractiveWindowProvider, file: vscode.TextDocument) {
    await vscode.window.showTextDocument(file);
    const activeInteractiveWindow = iwProvider.get(file.uri)!;
    await waitForActiveInteractiveWindow(iwProvider, activeInteractiveWindow);
    await vscode.commands.executeCommand(Commands.RunFileInInteractiveWindows, file.uri);
    return activeInteractiveWindow;
}

export async function closeInteractiveWindow(interactiveWindow: IInteractiveWindow) {
    if (interactiveWindow.notebookDocument) {
        const editor = vscode.window.visibleNotebookEditors.find(
            (n) => n.notebook === interactiveWindow.notebookDocument
        );
        if (editor) {
            await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
            await vscode.commands.executeCommand('interactive.input.focus');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await sleep(500); // Seems to be some flakiness in VS code closing a window.
        }
        interactiveWindow.dispose();
    }
}

export async function waitForLastCellToComplete(
    interactiveWindowProvider: IInteractiveWindowProvider,
    interactiveWindow: IInteractiveWindow,
    numberOfCells: number = -1,
    errorsOkay?: boolean
) {
    await waitForActiveInteractiveWindow(interactiveWindowProvider, interactiveWindow);
    let codeCell: vscode.NotebookCell | undefined;
    await waitForCondition(
        async () => {
            const codeCells = interactiveWindow.notebookDocument
                ?.getCells()
                .filter((c) => c.kind === vscode.NotebookCellKind.Code);
            codeCell = codeCells && codeCells.length ? codeCells[codeCells.length - 1] : undefined;
            return codeCell && (numberOfCells === -1 || numberOfCells === codeCells!.length) ? true : false;
        },
        defaultNotebookTestTimeout,
        `No code cell found in interactive window notebook document`
    );
    if (errorsOkay) {
        await waitForCellExecutionToComplete(codeCell!);
    } else {
        await waitForExecutionCompletedSuccessfully(codeCell!);
    }
    return codeCell!;
}
