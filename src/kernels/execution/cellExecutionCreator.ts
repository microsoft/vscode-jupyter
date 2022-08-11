// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import {
    CancellationToken,
    NotebookCell,
    NotebookCellExecution,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookController
} from 'vscode';

/**
 * Wrapper class around NotebookCellExecution that allows us to
 * - Call start more than once
 * - Do something when 'end' is called
 */
export class NotebookCellExecutionWrapper implements NotebookCellExecution {
    public started: boolean = false;
    constructor(
        private readonly _impl: NotebookCellExecution,
        public controllerId: string,
        private _endCallback: (() => void) | undefined
    ) {}
    public get cell(): NotebookCell {
        return this._impl.cell;
    }
    public get token(): CancellationToken {
        return this._impl.token;
    }
    public get executionOrder(): number | undefined {
        return this._impl.executionOrder;
    }
    public set executionOrder(value: number | undefined) {
        this._impl.executionOrder = value;
    }
    start(startTime?: number): void {
        // Allow this to be called more than once (so we can switch out a kernel during running a cell)
        if (!this.started) {
            this.started = true;
            this._impl.start(startTime);
        }
    }
    end(success: boolean | undefined, endTime?: number): void {
        if (this._endCallback) {
            try {
                this._impl.end(success, endTime);
            } finally {
                this._endCallback();
                this._endCallback = undefined;
            }
        }
    }
    clearOutput(cell?: NotebookCell): Thenable<void> {
        return this._impl.clearOutput(cell);
    }
    replaceOutput(out: NotebookCellOutput | NotebookCellOutput[], cell?: NotebookCell): Thenable<void> {
        return this._impl.replaceOutput(out, cell);
    }
    appendOutput(out: NotebookCellOutput | NotebookCellOutput[], cell?: NotebookCell): Thenable<void> {
        return this._impl.appendOutput(out, cell);
    }
    replaceOutputItems(
        items: NotebookCellOutputItem | NotebookCellOutputItem[],
        output: NotebookCellOutput
    ): Thenable<void> {
        return this._impl.replaceOutputItems(items, output);
    }
    appendOutputItems(
        items: NotebookCellOutputItem | NotebookCellOutputItem[],
        output: NotebookCellOutput
    ): Thenable<void> {
        return this._impl.appendOutputItems(items, output);
    }
}

/**
 * Class for mapping cells to an instance of a NotebookCellExecution object
 */
export class CellExecutionCreator {
    private static _map = new Map<string, NotebookCellExecutionWrapper>();
    static getOrCreate(cell: NotebookCell, controller: NotebookController) {
        let cellExecution: NotebookCellExecutionWrapper | undefined;
        const key = cell.document.uri.toString();
        cellExecution = this.get(cell);
        if (!cellExecution) {
            cellExecution = CellExecutionCreator.create(key, cell, controller);
        } else {
            // Cell execution may already exist, but its controller may be different
            if (cellExecution.controllerId !== controller.id) {
                // Stop the old execution so we don't have more than one for a cell at a time.
                const oldExecution = cellExecution;
                oldExecution.end(undefined);

                // Create a new one with the new controller
                cellExecution = CellExecutionCreator.create(key, cell, controller);

                // Start the new one off now if the old one was already started
                if (oldExecution.started) {
                    cellExecution.start(new Date().getTime());
                }
            }
        }
        return cellExecution;
    }
    static get(cell: NotebookCell) {
        const key = cell.document.uri.toString();
        return CellExecutionCreator._map.get(key);
    }

    private static create(key: string, cell: NotebookCell, controller: NotebookController) {
        const result = new NotebookCellExecutionWrapper(
            controller.createNotebookCellExecution(cell),
            controller.id,
            () => {
                CellExecutionCreator._map.delete(key);
            }
        );
        CellExecutionCreator._map.set(key, result);
        return result;
    }
}
