// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCell } from 'vscode';
import { ITracebackFormatter } from '../../kernels/types';
import { InteractiveWindowView } from '../../notebooks/constants';
import { CellHashProviderFactory } from '../editor-integration/cellHashProviderFactory';

@injectable()
export class InteractiveWindowTracebackFormatter implements ITracebackFormatter {
    constructor(@inject(CellHashProviderFactory) private readonly cellHashProviderFactory: CellHashProviderFactory) {}
    format(cell: NotebookCell, traceback: string[]): string[] {
        if (cell.notebook.notebookType !== InteractiveWindowView) {
            return traceback;
        }
        const cellHasProvider = this.cellHashProviderFactory.get(cell.notebook);
        return cellHasProvider ? cellHasProvider.modifyTraceback(traceback) : traceback;
    }
}
