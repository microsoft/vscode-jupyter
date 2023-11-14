// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    NotebookCell,
    NotebookCellExecution,
    NotebookCellOutput,
    NotebookCellOutputItem,
    TextDocument
} from 'vscode';
import { traceInfo, traceVerbose } from '../../platform/logging';
import { IKernelController } from '../types';
import { noop } from '../../platform/common/utils/misc';

/**
 * Wrapper class around NotebookCellExecution that allows us to
 * - Call start more than once
 * - Do something when 'end' is called
 */
export class NotebookCellExecutionWrapper implements NotebookCellExecution {
    public started: boolean = false;
    private _startTime?: number;
    /**
     * @param {boolean} [clearOutputOnStartWithTime=false] If true, clear the output when start is called with a time.
     */
    constructor(
        private readonly _impl: NotebookCellExecution,
        public controllerId: string,
        private _endCallback: (() => void) | undefined,
        private readonly clearOutputOnStartWithTime = false
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
    private startIfNecessary() {
        if (!this.started) {
            this._impl.start();
        }
    }
    start(startTime?: number): void {
        // Allow this to be called more than once (so we can switch out a kernel during running a cell)
        if (!this.started) {
            this.started = true;
            this._impl.start(startTime);
            this._startTime = startTime;
            // We clear the output as soon as we start,
            // We generally start with a time, when we receive a response from the kernel,
            // indicating the fact that the kernel has started processing the output.
            // That's when we clear the output. (ideally it should be cleared as soon as its queued, but thats an upstream core issue).
            if (this.clearOutputOnStartWithTime) {
                traceVerbose(`Start cell ${this.cell.index} execution @ ${startTime} (clear output)`);
                this._impl.clearOutput().then(noop, noop);
            } else {
                traceVerbose(`Start cell ${this.cell.index} execution @ ${startTime}`);
            }
        }
    }
    end(success: boolean | undefined, endTime?: number): void {
        if (this._endCallback) {
            try {
                this._impl.end(success, endTime);
                traceInfo(
                    `End cell ${this.cell.index} execution after ${
                        ((endTime || 0) - (this._startTime || 0)) / 1000
                    }s, completed @ ${endTime}, started @ ${this._startTime}`
                );
            } finally {
                this._endCallback();
                this._endCallback = undefined;
            }
        }
    }
    clearOutput(cell?: NotebookCell): Thenable<void> {
        this.startIfNecessary();
        return this._impl.clearOutput(cell);
    }
    replaceOutput(out: NotebookCellOutput | NotebookCellOutput[], cell?: NotebookCell): Thenable<void> {
        this.startIfNecessary();
        return this._impl.replaceOutput(out, cell);
    }
    appendOutput(out: NotebookCellOutput | NotebookCellOutput[], cell?: NotebookCell): Thenable<void> {
        this.startIfNecessary();
        return this._impl.appendOutput(out, cell);
    }
    replaceOutputItems(
        items: NotebookCellOutputItem | NotebookCellOutputItem[],
        output: NotebookCellOutput
    ): Thenable<void> {
        this.startIfNecessary();
        return this._impl.replaceOutputItems(items, output);
    }
    appendOutputItems(
        items: NotebookCellOutputItem | NotebookCellOutputItem[],
        output: NotebookCellOutput
    ): Thenable<void> {
        this.startIfNecessary();
        return this._impl.appendOutputItems(items, output);
    }
}

/**
 * Class for mapping cells to an instance of a NotebookCellExecution object
 */
export class CellExecutionCreator {
    private static _map = new WeakMap<TextDocument, NotebookCellExecutionWrapper>();
    static getOrCreate(cell: NotebookCell, controller: IKernelController, clearOutputOnStartWithTime = false) {
        let cellExecution: NotebookCellExecutionWrapper | undefined;
        const key = cell.document;
        cellExecution = this.get(cell);
        if (!cellExecution) {
            cellExecution = CellExecutionCreator.create(key, cell, controller, clearOutputOnStartWithTime);
        } else {
            // Cell execution may already exist, but its controller may be different
            if (cellExecution.controllerId !== controller.id) {
                // Stop the old execution so we don't have more than one for a cell at a time.
                const oldExecution = cellExecution;
                oldExecution.end(undefined);

                // Create a new one with the new controller
                cellExecution = CellExecutionCreator.create(key, cell, controller, clearOutputOnStartWithTime);

                // Start the new one off now if the old one was already started
                if (oldExecution.started) {
                    cellExecution.start(new Date().getTime());
                }
            }
        }
        return cellExecution;
    }
    static get(cell: NotebookCell) {
        const key = cell.document;
        return CellExecutionCreator._map.get(key);
    }

    private static create(
        key: TextDocument,
        cell: NotebookCell,
        controller: IKernelController,
        clearOutputOnStartWithTime = false
    ) {
        const result = new NotebookCellExecutionWrapper(
            controller.createNotebookCellExecution(cell),
            controller.id,
            () => {
                CellExecutionCreator._map.delete(key);
            },
            clearOutputOnStartWithTime
        );
        CellExecutionCreator._map.set(key, result);
        return result;
    }
}
