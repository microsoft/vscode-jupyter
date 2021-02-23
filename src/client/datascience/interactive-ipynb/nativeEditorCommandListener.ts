// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Uri } from 'vscode';

import { ICommandManager } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { IDisposableRegistry } from '../../common/types';
import { captureTelemetry } from '../../telemetry';
import { CommandSource } from '../../testing/common/constants';
import { Commands, Telemetry } from '../constants';
import { IDataScienceCommandListener, IDataScienceErrorHandler, INotebookEditorProvider } from '../types';

@injectable()
export class NativeEditorCommandListener implements IDataScienceCommandListener {
    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(INotebookEditorProvider) private provider: INotebookEditorProvider,
        @inject(IDataScienceErrorHandler) private dataScienceErrorHandler: IDataScienceErrorHandler
    ) {}

    public register(commandManager: ICommandManager): void {
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
            commandManager.registerCommand(Commands.NotebookEditorInterruptKernel, () => this.interruptKernel())
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
            commandManager.registerCommand(Commands.NativeNotebookRunAllCellsAbove, (uri) => this.runAbove(uri))
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NativeNotebookRunCellAndAllBelow, (uri) =>
                this.runCellAndBelow(uri)
            )
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

    private interruptKernel() {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.interruptKernel().ignoreErrors();
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

    private runAbove(uri: Uri): void {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.runAbove(uri);
        }
    }
    private runCellAndBelow(uri: Uri): void {
        const activeEditor = this.provider.activeEditor;
        if (activeEditor) {
            activeEditor.runCellAndBelow(uri);
        }
    }
}
