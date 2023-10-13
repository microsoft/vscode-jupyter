// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { activatePylance } from './pylance';
import { findNotebookAndCell, noop } from './common';
import { SymbolsTracker } from './symbols';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const optInto = vscode.workspace.getConfiguration('jupyter').get<boolean>('executionAnalysis.enabled');
    if (!optInto) {
        return;
    }

    const referencesProvider = await activatePylance();
    if (!referencesProvider) {
        vscode.window
            .showErrorMessage('Could not get references provider from language server, Pylance prerelease required.')
            .then(noop, noop);
        return;
    }

    const symbolsManager = new SymbolsTracker(referencesProvider);
    context.subscriptions.push(symbolsManager);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'jupyter.selectSuccessorCells',
            async (cell: vscode.NotebookCell | undefined) => {
                const matched = findNotebookAndCell(cell);
                if (!matched) {
                    return;
                }

                const { notebook, cell: currentCell } = matched;
                await symbolsManager.selectSuccessorCells(notebook, currentCell);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter.runSuccessorCells', async (cell: vscode.NotebookCell | undefined) => {
            const matched = findNotebookAndCell(cell);
            if (!matched) {
                return;
            }

            const { notebook, cell: currentCell } = matched;
            await symbolsManager.runSuccessorCells(notebook, currentCell);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter.gatherCells', async (cell: vscode.NotebookCell | undefined) => {
            const matched = findNotebookAndCell(cell);
            if (!matched) {
                return;
            }

            const { notebook, cell: currentCell } = matched;
            const gatheredCells = (await symbolsManager.gatherCells(notebook, currentCell)) as vscode.NotebookCell[];
            if (gatheredCells) {
                // console.log(gatheredCells?.map(cell => `${cell.index}:\n ${cell.document.getText()}\n`));

                const nbCells = gatheredCells.map((cell) => {
                    return new vscode.NotebookCellData(
                        vscode.NotebookCellKind.Code,
                        cell.document.getText(),
                        cell.document.languageId
                    );
                });
                const doc = await vscode.workspace.openNotebookDocument(
                    'jupyter-notebook',
                    new vscode.NotebookData(nbCells)
                );
                await vscode.window.showNotebookDocument(doc, {
                    viewColumn: 1,
                    preserveFocus: true
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter.debugCellSymbols', async () => {
            const notebookEditor = vscode.window.activeNotebookEditor;
            if (notebookEditor) {
                await symbolsManager.debugSymbols(notebookEditor.notebook);
            }
        })
    );
}

// This method is called when your extension is deactivated
export function deactivate() {
    noop();
}
