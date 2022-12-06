// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';

/**
 * Error thrown when running cells in the interactive window.
 *
 * Cause:
 * Kernel.executeCell() returns an error when running a cell in the interactive window.
 *
 * Handled by:
 * Running cell in IW shows the error. If no running cell, then a notification is shown to the user.
 *
 */
export class InteractiveCellResultError extends Error {
    constructor(public readonly cell: NotebookCell) {
        super('Cell failed to execute');
    }
}
