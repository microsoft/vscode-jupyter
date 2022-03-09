// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { NotebookCell, NotebookCellOutput, NotebookDocument } from 'vscode';
import { IVSCodeNotebook } from '../../../common/application/types';
import { isJupyterNotebook } from '../../notebook/helpers/helpers';

@injectable()
export class CellOutputDisplayIdTracker {
    private displayIdCellOutputMappingPerDocument = new WeakMap<
        NotebookDocument,
        Map<string, { output: NotebookCellOutput; cell: NotebookCell }>
    >();
    private cellToDisplayIdMapping = new WeakMap<NotebookCell, string>();
    constructor(@inject(IVSCodeNotebook) notebooks: IVSCodeNotebook) {
        notebooks.onDidChangeNotebookDocument((e) => {
            if (!isJupyterNotebook(e.document)) {
                return;
            }
            // We are only interested in cells that were cleared
            if (e.type === 'changeCellOutputs') {
                e.cells
                    .filter((cell) => cell.outputs.length === 0)
                    .map((cell) => {
                        // If a cell was cleared, then remove the mapping, the output cannot exist anymore.
                        const displayIdToDelete = this.cellToDisplayIdMapping.get(cell);
                        if (displayIdToDelete) {
                            this.cellToDisplayIdMapping.delete(cell);
                            this.displayIdCellOutputMappingPerDocument.get(cell.notebook)?.delete(displayIdToDelete);
                        }
                    });
            }
        });
    }
    /**
     * Keep track of the mapping between display_id and the output.
     * When we need to update this display, we can resolve the promise & access the output.
     * The return value is a promise that needs to be resolved with the associated output thats been added to the DOM
     */
    public trackOutputByDisplayId(cell: NotebookCell, displayId: string, output: NotebookCellOutput) {
        let mapOfDisplayIdToOutput = this.displayIdCellOutputMappingPerDocument.get(cell.notebook);
        if (!mapOfDisplayIdToOutput) {
            mapOfDisplayIdToOutput = new Map<string, { output: NotebookCellOutput; cell: NotebookCell }>();
            this.displayIdCellOutputMappingPerDocument.set(cell.notebook, mapOfDisplayIdToOutput);
        }
        mapOfDisplayIdToOutput.set(displayId, { output, cell: cell });
        this.cellToDisplayIdMapping.set(cell, displayId);
    }
    /**
     * We return a promise, as we need to wait until the output is part of the DOM before we can update it.
     */
    public getMappedOutput(notebook: NotebookDocument, displayId: string): NotebookCellOutput | undefined {
        const mapOfDisplayIdToOutput = this.displayIdCellOutputMappingPerDocument.get(notebook);
        if (!mapOfDisplayIdToOutput) {
            return;
        }
        // Check if the cell still exists.
        const mapping = mapOfDisplayIdToOutput.get(displayId);
        return mapping?.cell.document.isClosed ? undefined : mapping?.output;
    }
}
