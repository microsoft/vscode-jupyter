// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { l10n, NotebookCell, NotebookDocument, NotebookEditorRevealType, NotebookRange, window } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { JupyterNotebookView } from '../../platform/common/constants';
import { dispose } from '../../platform/common/utils/lifecycle';
import { noop } from '../../platform/common/utils/misc';
import {
    CellCompletionNotificationMode,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry
} from '../../platform/common/types';
import { logger } from '../../platform/logging';
import * as uriPath from '../../platform/vscode-path/resources';
import {
    NotebookCellExecutionRequestEvent,
    NotebookCellExecutionResult,
    NotebookCellExecutionState,
    notebookCellExecutions,
    type NotebookCellExecutionStateChangeEvent
} from '../../platform/notebooks/cellExecutionStateService';

type ExecutionGroup = {
    readonly notebook: NotebookDocument;
    readonly cells: readonly NotebookCell[];
    readonly pendingCells: Set<NotebookCell>;
    readonly results: Map<NotebookCell, NotebookCellExecutionResult>;
    startedAt?: number;
};

type ExecutionResult = 'completed' | 'failed' | 'stopped';

const executionSummaryUpdateTimeoutMs = 500;
const executionSummaryPollIntervalMs = 10;

@injectable()
export class CellCompletionNotificationService implements IExtensionSyncActivationService, IDisposable {
    private readonly executionGroups = new WeakMap<NotebookCell, ExecutionGroup>();
    private readonly disposables: IDisposable[] = [];

    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService
    ) {
        disposables.push(this);
    }

    public activate(): void {
        this.disposables.push(
            notebookCellExecutions.onDidRequestNotebookCellExecution(this.onDidRequestNotebookCellExecution, this),
            notebookCellExecutions.onDidChangeNotebookCellExecutionState(
                this.onDidChangeNotebookCellExecutionState,
                this
            )
        );
    }

    public dispose(): void {
        dispose(this.disposables);
    }

    private onDidRequestNotebookCellExecution(event: NotebookCellExecutionRequestEvent): void {
        const notebook = event.cells[0]?.notebook;
        if (!notebook || notebook.notebookType !== JupyterNotebookView || notebook.isClosed) {
            return;
        }

        const cells = Array.from(
            new Set(event.cells.filter((cell) => cell.notebook === notebook && !cell.document.isClosed))
        );
        if (!cells.length) {
            return;
        }

        const group: ExecutionGroup = {
            notebook,
            cells,
            pendingCells: new Set(cells),
            results: new Map()
        };
        cells.forEach((cell) => this.executionGroups.set(cell, group));
    }

    private onDidChangeNotebookCellExecutionState(event: NotebookCellExecutionStateChangeEvent): void {
        const group = this.executionGroups.get(event.cell);
        if (!group) {
            return;
        }

        if (event.state === NotebookCellExecutionState.Executing) {
            group.startedAt ??= Date.now();
            return;
        }

        if (event.state !== NotebookCellExecutionState.Idle) {
            return;
        }

        if (event.result) {
            group.results.set(event.cell, event.result);
        }

        group.pendingCells.delete(event.cell);
        this.executionGroups.delete(event.cell);
        if (group.pendingCells.size) {
            return;
        }

        group.cells.forEach((cell) => {
            if (this.executionGroups.get(cell) === group) {
                this.executionGroups.delete(cell);
            }
        });
        if (group.startedAt !== undefined) {
            this.notifyWhenComplete(group, Date.now() - group.startedAt).catch(noop);
        }
    }

    private async notifyWhenComplete(group: ExecutionGroup, durationMs: number): Promise<void> {
        // NotebookCellExecution.end() updates executionSummary asynchronously in VS Code.
        // The internal Idle event can arrive before that update, so briefly wait for the final summaries.
        await this.waitForExecutionSummaries(group);
        if (group.notebook.isClosed) {
            return;
        }

        const settings = this.configuration.getSettings(group.notebook.uri);
        const { result, target } = this.getResultAndTarget(group);
        const notificationMode = this.getNotificationMode(
            settings.cellCompletionNotificationMode,
            settings.cellCompletionNotificationFailureMode,
            result
        );
        logger.trace(
            'Cell completion notification decision: result=' +
                result +
                ', generalMode=' +
                settings.cellCompletionNotificationMode +
                ', failureMode=' +
                settings.cellCompletionNotificationFailureMode +
                ', effectiveMode=' +
                notificationMode +
                ', focused=' +
                window.state.focused +
                ', durationMs=' +
                Math.round(durationMs) +
                ', minimumDurationSeconds=' +
                settings.cellCompletionNotificationMinimumDuration
        );
        if (
            notificationMode === 'off' ||
            (notificationMode === 'windowNotFocused' && window.state.focused) ||
            durationMs < Math.max(1, settings.cellCompletionNotificationMinimumDuration) * 1_000
        ) {
            return;
        }

        const durationSeconds = Math.max(1, Math.round(durationMs / 1_000));
        const message = this.getCompletionMessage(group, result, durationSeconds);
        const showCell = l10n.t('Show Cell');
        const selection = await window.showInformationMessage(message, showCell);
        if (selection === showCell) {
            await this.showCell(target);
        }
    }

    private async waitForExecutionSummaries(group: ExecutionGroup): Promise<void> {
        const deadline = Date.now() + executionSummaryUpdateTimeoutMs;
        while (
            group.cells.some((cell) => !group.results.has(cell) && cell.executionSummary?.success === undefined) &&
            Date.now() < deadline
        ) {
            await new Promise<void>((resolve) => setTimeout(resolve, executionSummaryPollIntervalMs));
        }
    }

    private getNotificationMode(
        generalMode: CellCompletionNotificationMode,
        failureMode: CellCompletionNotificationMode,
        result: ExecutionResult
    ): CellCompletionNotificationMode {
        if (result !== 'failed') {
            return generalMode;
        }

        const priority: Record<CellCompletionNotificationMode, number> = {
            off: 0,
            windowNotFocused: 1,
            always: 2
        };
        return priority[failureMode] > priority[generalMode] ? failureMode : generalMode;
    }

    private getResultAndTarget(group: ExecutionGroup): { result: ExecutionResult; target: NotebookCell } {
        const failedCell = group.cells.find((cell) => this.getCellResult(group, cell) === 'failed');
        if (failedCell) {
            return { result: 'failed', target: failedCell };
        }

        const stoppedCell = group.cells.find((cell) => {
            const result = this.getCellResult(group, cell);
            return result === 'cancelled' || result === undefined;
        });
        if (stoppedCell) {
            return { result: 'stopped', target: stoppedCell };
        }

        return { result: 'completed', target: group.cells[group.cells.length - 1] };
    }

    private getCellResult(group: ExecutionGroup, cell: NotebookCell): NotebookCellExecutionResult | undefined {
        const result = group.results.get(cell);
        if (result) {
            return result;
        }
        if (cell.executionSummary?.success === true) {
            return 'success';
        }
        if (cell.executionSummary?.success === false) {
            return 'failed';
        }
        return undefined;
    }

    private getCompletionMessage(group: ExecutionGroup, result: ExecutionResult, durationSeconds: number): string {
        const notebookName = uriPath.basename(group.notebook.uri);
        const duration = durationSeconds === 1 ? l10n.t('1 second') : l10n.t('{0} seconds', durationSeconds);
        if (group.cells.length === 1) {
            const cellNumber = group.cells[0].index + 1;
            switch (result) {
                case 'completed':
                    return l10n.t('Cell {0} in {1} completed after {2}.', cellNumber, notebookName, duration);
                case 'failed':
                    return l10n.t('Cell {0} in {1} failed after {2}.', cellNumber, notebookName, duration);
                case 'stopped':
                    return l10n.t('Cell {0} in {1} stopped after {2}.', cellNumber, notebookName, duration);
            }
        }

        switch (result) {
            case 'completed':
                return l10n.t('{0} cells in {1} completed after {2}.', group.cells.length, notebookName, duration);
            case 'failed':
                return l10n.t(
                    '{0} cells in {1} finished with errors after {2}.',
                    group.cells.length,
                    notebookName,
                    duration
                );
            case 'stopped':
                return l10n.t('{0} cells in {1} stopped after {2}.', group.cells.length, notebookName, duration);
        }
    }

    private async showCell(cell: NotebookCell): Promise<void> {
        try {
            const notebook = cell.notebook;
            if (notebook.isClosed || cell.document.isClosed) {
                return;
            }

            const cellIndex = cell.index;
            if (cellIndex < 0 || cellIndex >= notebook.cellCount || notebook.cellAt(cellIndex) !== cell) {
                return;
            }

            const editor = await window.showNotebookDocument(notebook);
            if (
                notebook.isClosed ||
                cell.index !== cellIndex ||
                cellIndex >= notebook.cellCount ||
                notebook.cellAt(cellIndex) !== cell
            ) {
                return;
            }
            editor.revealRange(new NotebookRange(cellIndex, cellIndex + 1), NotebookEditorRevealType.InCenter);
        } catch {
            // The notebook or cell may have closed while the notification action was being handled.
        }
    }
}
