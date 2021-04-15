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
    constructor(
    ) { }

    provideCellStatusBarItems(cell: NotebookCell, _token: CancellationToken): ProviderResult<NotebookCellStatusBarItem[]> {
        const statusMessage = getCellStatusMessageBasedOnFirstCellErrorOutput(cell.outputs);
        return [new NotebookCellStatusBarItem(statusMessage, NotebookCellStatusBarAlignment.Left)];
    }
}