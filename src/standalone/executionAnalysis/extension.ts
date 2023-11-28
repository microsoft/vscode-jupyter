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
        return;
    }

    const symbolsManager = new SymbolsTracker(referencesProvider);
    context.subscriptions.push(symbolsManager);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'jupyter.selectDependentCells',
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
        vscode.commands.registerCommand('jupyter.runPrecedentCells', async (cell: vscode.NotebookCell | undefined) => {
            const matched = findNotebookAndCell(cell);
            if (!matched) {
                return;
            }

            const { notebook, cell: currentCell } = matched;
            await symbolsManager.runPrecedentCells(notebook, currentCell);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter.runDependentCells', async (cell: vscode.NotebookCell | undefined) => {
            const matched = findNotebookAndCell(cell);
            if (!matched) {
                return;
            }

            const { notebook, cell: currentCell } = matched;
            await symbolsManager.runSuccessorCells(notebook, currentCell);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'jupyter.selectPrecedentCells',
            async (cell: vscode.NotebookCell | undefined) => {
                const matched = findNotebookAndCell(cell);
                if (!matched) {
                    return;
                }

                const { notebook, cell: currentCell } = matched;
                await symbolsManager.selectPrecedentCells(notebook, currentCell);
            }
        )
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
