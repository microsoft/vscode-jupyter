// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { NotebookCell, Uri } from 'vscode';

import { ICommandManager } from '../../common/application/types';
import { traceError, traceInfo } from '../../common/logger';
import { IDisposableRegistry } from '../../common/types';
import { captureTelemetry } from '../../telemetry';
import { CommandSource } from '../../testing/common/constants';
import { Commands, Telemetry } from '../constants';
import {
    IDataScienceCommandListener,
    IDataScienceErrorHandler,
    IInteractiveWindowProvider,
    INotebookEditorProvider
} from '../types';
import { IScratchPadProvider } from '../notebook/types';

@injectable()
export class NativeEditorCommandListener implements IDataScienceCommandListener {
    private commandManager: ICommandManager | undefined;
    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(INotebookEditorProvider) private provider: INotebookEditorProvider,
        @inject(IDataScienceErrorHandler) private dataScienceErrorHandler: IDataScienceErrorHandler,
        @inject(IInteractiveWindowProvider) private readonly interactiveProvider: IInteractiveWindowProvider,
        @inject(IScratchPadProvider) private readonly scratchPadProvider: IScratchPadProvider
    ) {}

    public register(commandManager: ICommandManager): void {
        this.commandManager = commandManager;
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorUndoCells, () => this.undoCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorRedoCells, () => this.redoCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorRemoveAllCells, () => this.removeAllCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorInterruptKernel, (notebookUri: Uri | undefined) =>
                this.interruptKernel(notebookUri)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorRestartKernel, () => this.restartKernel())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(
                Commands.OpenNotebook,
                (file?: Uri, contents?: string, _cmdSource: CommandSource = CommandSource.commandPalette) =>
                    this.openNotebook(file, contents)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorRunAllCells, () => this.runAllCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorAddCellBelow, () => this.addCellBelow())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NativeNotebookRunAllCellsAbove, (cell) => this.runAbove(cell))
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NativeNotebookRunCellAndAllBelow, (cell) =>
                this.runCellAndBelow(cell)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.OpenScratchPad, (cell) => this.openScratchPad(cell))
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.OpenScratchPadInteractive, (cell) =>
                this.openScratchPadInteractive(cell)
            )
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.OpenContextualHelp, () => this.openContextualHelp())
        );
    }

    private runAllCells() {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.runAllCells();
        }
    }

    private addCellBelow() {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.addCellBelow();
        }
    }

    private undoCells() {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.undoCells();
        }
    }

    private redoCells() {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.redoCells();
        }
    }

    private removeAllCells() {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.removeAllCells();
        }
    }

    private interruptKernel(notebookUri: Uri | undefined) {
        // `document` may be undefined if this command is invoked from the command palette.
        if (notebookUri) {
            traceInfo(`Interrupt requested for ${notebookUri.toString()} in nativeEditorCommandListener`);
            traceInfo(`this.provider.activeEditor?.file.toString() = ${this.provider.activeEditor?.file.toString()}`);
            traceInfo(`this.provider.editors = ${this.provider.editors.map((item) => item.file.toString())}`);
            const target =
                this.provider.activeEditor?.file.toString() === notebookUri.toString()
                    ? this.provider.activeEditor
                    : this.provider.editors.find((editor) => editor.file.toString() === notebookUri.toString());
            if (target) {
                target.interruptKernel().ignoreErrors();
            } else {
                traceInfo(
                    `Interrupt requested for ${notebookUri.toString()} in nativeEditorCommandListener & editor not found`
                );
            }
        } else {
            traceInfo(`Interrupt requested for active editor in nativeEditorCommandListener`);
            this.provider.activeEditor?.interruptKernel().ignoreErrors();
        }
    }

    private async restartKernel() {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            await activeEditor.restartKernel().catch(traceError.bind('Failed to restart kernel'));
        }
    }

    @captureTelemetry(Telemetry.OpenNotebook, { scope: 'command' }, false)
    private async openNotebook(file?: Uri, contents?: string): Promise<void> {
        if (file && path.extname(file.fsPath).toLocaleLowerCase() === '.ipynb') {
            try {
                // Then take the contents and load it.
                await this.provider.open(file);
            } catch (e) {
                await this.dataScienceErrorHandler.handleError(e);
            }
        } else if (contents) {
            try {
                await this.provider.createNew({ contents });
            } catch (e) {
                await this.dataScienceErrorHandler.handleError(e);
            }
        }
    }

    private runAbove(cell: NotebookCell | undefined): void {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.runAbove(cell);
        }
    }
    private runCellAndBelow(cell: NotebookCell | undefined): void {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.runCellAndBelow(cell);
        }
    }

    private async openScratchPad(cell: NotebookCell | undefined): Promise<void> {
        // For all contributed views vscode creates a command with the format [view ID].focus to focus that view
        // It's the given way to focus a single view so using that here, note that it needs to match the view ID
        await this.commandManager?.executeCommand('jupyterScratchPad.focus');

        // Once it has focus, send it the cell if we have one
        if (cell) {
            this.scratchPadProvider.scratchPad?.loadCell(cell);
        }
    }

    private async openContextualHelp(): Promise<void> {
        // For all contributed views vscode creates a command with the format [view ID].focus to focus that view
        // It's the given way to focus a single view so using that here, note that it needs to match the view ID
        await this.commandManager?.executeCommand('jupyterContextualHelp.focus');
    }

    // This also works, not sure if we want both or not.
    private openScratchPadInteractive(cell: NotebookCell | undefined): void {
        const file = cell?.notebook.uri || this.provider.activeEditor?.file;
        if (file) {
            this.interactiveProvider
                .getOrCreate(file)
                .then(async (i) => {
                    if (cell) {
                        await i.addCode(cell.document.getText(), undefined, 0);
                    }
                })
                .ignoreErrors();
        }
    }
}
