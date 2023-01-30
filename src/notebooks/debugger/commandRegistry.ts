// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCell } from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../platform/common/application/types';

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { Commands } from '../../platform/common/constants';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { sendTelemetryEvent } from '../../telemetry';
import { DebuggingTelemetry } from './constants';
import { INotebookDebuggingManager, KernelDebugMode } from './debuggingTypes';

/**
 * Class that registers command handlers for interactive window commands.
 */
@injectable()
export class CommandRegistry implements IDisposable, IExtensionSyncActivationService {
    constructor(
        @inject(INotebookDebuggingManager) private readonly debuggingManager: INotebookDebuggingManager,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {}

    public activate() {
        this.disposables.push(this.commandManager.registerCommand(Commands.RunByLine, this.runByLine, this));
        this.disposables.push(this.commandManager.registerCommand(Commands.RunByLineNext, this.runByLineNext, this));
        this.disposables.push(this.commandManager.registerCommand(Commands.RunByLineStop, this.runByLineStop, this));
        this.disposables.push(
            this.commandManager.registerCommand(Commands.RunAndDebugCell, this.runAndDebugCell, this)
        );
    }

    private async runByLine(cell: NotebookCell | undefined) {
        sendTelemetryEvent(DebuggingTelemetry.clickedRunByLine);
        cell ??= this.getCellFromActiveEditor();
        if (!cell) {
            return;
        }

        await this.debuggingManager.tryToStartDebugging(KernelDebugMode.RunByLine, cell);
    }

    private async runByLineNext(cell: NotebookCell | undefined) {
        cell ??= this.getCellFromActiveEditor();
        if (!cell) {
            return;
        }

        this.debuggingManager.runByLineNext(cell);
    }

    private async runByLineStop(cell: NotebookCell | undefined) {
        cell ??= this.getCellFromActiveEditor();
        if (!cell) {
            return;
        }

        this.debuggingManager.runByLineStop(cell);
    }

    private async runAndDebugCell(cell: NotebookCell | undefined) {
        sendTelemetryEvent(DebuggingTelemetry.clickedRunAndDebugCell);
        cell ??= this.getCellFromActiveEditor();
        if (!cell) {
            return;
        }

        await this.debuggingManager.tryToStartDebugging(KernelDebugMode.Cell, cell);
    }

    private getCellFromActiveEditor(): NotebookCell | undefined {
        const editor = this.vscNotebook.activeNotebookEditor;
        if (editor) {
            const range = editor.selections[0];
            if (range) {
                return editor.notebook.cellAt(range.start);
            }
        }
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
}
