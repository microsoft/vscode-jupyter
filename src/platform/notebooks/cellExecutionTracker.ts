// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { NotebookDocument, NotebookCell, Disposable } from 'vscode';
import { DisposableBase } from '../common/utils/lifecycle';
import { ICellExecutionTracker } from '../../notebooks/types';
import { IExtensionSyncActivationService } from '../activation/types';
import {
    NotebookCellExecutionState,
    notebookCellExecutions,
    type NotebookCellExecutionStateChangeEvent
} from './cellExecutionStateService';

/**
 * Service that tracks whether any cells have been executed in notebooks.
 * This is used to determine if a kernel restart is needed after package installation.
 */
@injectable()
export class CellExecutionTracker extends DisposableBase implements ICellExecutionTracker, IExtensionSyncActivationService {
    private readonly _notebookExecutionState = new Map<string, boolean>();

    constructor() {
        super();
    }

    /**
     * Activate the service and start listening for cell execution events.
     */
    public activate(): void {
        this.hookupEventHandlers();
    }

    /**
     * Check if any cells have been executed in the given notebook.
     */
    public hasExecutedCells(notebook: NotebookDocument): boolean {
        return this._notebookExecutionState.get(notebook.uri.toString()) ?? false;
    }

    /**
     * Reset the execution state for a notebook (e.g., after kernel restart).
     */
    public resetExecutionState(notebook: NotebookDocument): void {
        this._notebookExecutionState.set(notebook.uri.toString(), false);
    }

    private hookupEventHandlers(): void {
        // Listen for cell execution state changes
        this.disposables.push(
            notebookCellExecutions.onDidChangeNotebookCellExecutionState(
                this.onDidChangeNotebookCellExecutionState,
                this
            )
        );

        // Clean up when notebooks are closed
        this.disposables.push(
            Disposable.from({
                dispose: () => {
                    // Clear the map when disposing
                    this._notebookExecutionState.clear();
                }
            })
        );
    }

    private onDidChangeNotebookCellExecutionState(event: NotebookCellExecutionStateChangeEvent): void {
        const { cell, state } = event;
        
        // We only care about cells that have finished executing (moved to Idle state)
        // and have an execution order (meaning they were actually executed)
        if (state === NotebookCellExecutionState.Idle && cell.executionSummary?.executionOrder !== undefined) {
            const notebookUri = cell.notebook.uri.toString();
            this._notebookExecutionState.set(notebookUri, true);
        }
    }
}