// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import {
    CancellationToken,
    NotebookCell,
    NotebookCellStatusBarAlignment,
    NotebookCellStatusBarItem,
    NotebookCellStatusBarItemProvider as VSCNotebookCellStatusBarItemProvider,
    ProviderResult
} from 'vscode';
import { getCellStatusMessageBasedOnFirstCellErrorOutput } from './helpers/helpers';

/**
 * This calls controls the status messages that we see on our Notebook cells
 */
@injectable()
export class StatusBarProvider implements VSCNotebookCellStatusBarItemProvider {
    // Weakmap, as we don't own the lifetime of either of these, just a helpful mapping for tests
    private static cellStatusMappings = new WeakMap<NotebookCell, NotebookCellStatusBarItem>();
    constructor(
    ) { }

    // Allow test code to see what status is currently on any cell
    public static getCellStatusBarItem(cell: NotebookCell): NotebookCellStatusBarItem | undefined {
        return StatusBarProvider.cellStatusMappings.get(cell);
    }

    // For any NotebookCell, check its output to see if we need to put up a status message
    provideCellStatusBarItems(cell: NotebookCell, _token: CancellationToken): ProviderResult<NotebookCellStatusBarItem[]> {
        // Get our message from the cell output and create a basic message
        const statusMessage = getCellStatusMessageBasedOnFirstCellErrorOutput(cell.outputs);
        const statusItem = new NotebookCellStatusBarItem(statusMessage, NotebookCellStatusBarAlignment.Left);

        // Save our mapping
        StatusBarProvider.cellStatusMappings.set(cell, statusItem);
        return [statusItem];
    }
}
