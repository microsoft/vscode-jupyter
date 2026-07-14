// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, workspace, type NotebookCell } from 'vscode';
import { trackDisposable } from '../common/utils/lifecycle';

/**
 * The execution state of a notebook cell.
 */
export enum NotebookCellExecutionState {
    /**
     * The cell is idle.
     */
    Idle = 1,
    /**
     * Execution for the cell is pending.
     */
    Pending = 2,
    /**
     * The cell is currently executing.
     */
    Executing = 3
}

export type NotebookCellExecutionResult = 'success' | 'failed' | 'cancelled';

/**
 * An event describing a cell execution state change.
 */
export interface NotebookCellExecutionStateChangeEvent {
    /**
     * The {@link NotebookCell cell} for which the execution state has changed.
     */
    readonly cell: NotebookCell;
    /**
     * The new execution state of the cell.
     */
    readonly state: NotebookCellExecutionState;
    /**
     * The terminal result when {@link state} is {@link NotebookCellExecutionState.Idle}.
     */
    readonly result?: NotebookCellExecutionResult;
}

export interface NotebookCellExecutionRequestEvent {
    /**
     * Cells included in one execution request, such as Run Cell, Run Selected, or Run All.
     */
    readonly cells: readonly NotebookCell[];
}

export namespace notebookCellExecutions {
    const eventEmitter = trackDisposable(new EventEmitter<NotebookCellExecutionStateChangeEvent>());
    const requestEventEmitter = trackDisposable(new EventEmitter<NotebookCellExecutionRequestEvent>());

    /**
     * An {@link Event} which fires when the execution state of a cell has changed.
     */
    // todo@API this is an event that is fired for a property that cells don't have and that makes me wonder
    // how a correct consumer works, e.g the consumer could have been late and missed an event?
    export const onDidChangeNotebookCellExecutionState = eventEmitter.event;

    /**
     * An event which fires when the Jupyter notebook controller accepts a group of cells for execution.
     */
    export const onDidRequestNotebookCellExecution = requestEventEmitter.event;

    export function requestNotebookCellExecution(cells: readonly NotebookCell[]) {
        if (cells.length) {
            requestEventEmitter.fire({ cells });
        }
    }

    export function changeCellState(
        cell: NotebookCell,
        state: NotebookCellExecutionState,
        executionOrder?: number,
        result?: NotebookCellExecutionResult
    ) {
        if (state !== NotebookCellExecutionState.Idle || !executionOrder) {
            eventEmitter.fire({ cell, state, result });
            return;
        }
        // Wait for VS Code to update the cell execution state before firing the event.
        const disposable = trackDisposable(
            workspace.onDidChangeNotebookDocument((e) => {
                if (e.notebook !== cell.notebook) {
                    return;
                }
                const currentCellChange = e.cellChanges.find((c) => c.cell === cell);
                if (currentCellChange?.cell?.executionSummary?.executionOrder === executionOrder) {
                    disposable.dispose();
                    eventEmitter.fire({ cell, state: NotebookCellExecutionState.Idle, result });
                }
            })
        );
    }
}
