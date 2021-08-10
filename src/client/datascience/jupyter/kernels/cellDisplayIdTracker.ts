// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { NotebookCell, NotebookCellOutput, NotebookDocument } from 'vscode';
import { IVSCodeNotebook } from '../../../common/application/types';
import { createDeferred, Deferred } from '../../../common/utils/async';

@injectable()
export class CellOutputDisplayIdTracker {
    private displayIdCellOutputMappingPerDocument = new WeakMap<
        NotebookDocument,
        Map<string, { output: Deferred<NotebookCellOutput>; cell: NotebookCell }>
    >();
    private cellToDisplayIdMapping = new WeakMap<NotebookCell, string>();
    constructor(@inject(IVSCodeNotebook) notebooks: IVSCodeNotebook) {
        notebooks.onDidChangeNotebookDocument((e) => {
            // We are only interested in cells that were cleared
            if (e.type === 'changeCellOutputs') {
                e.cells
                    .filter((cell) => cell.outputs.length)
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
    public trackOutputByDisplayId(cell: NotebookCell, displayId: string): Deferred<NotebookCellOutput> {
        const displayOutputAdded = createDeferred<NotebookCellOutput>();
        let mapOfDisplayIdToOutput = this.displayIdCellOutputMappingPerDocument.get(cell.notebook);
        if (!mapOfDisplayIdToOutput) {
            mapOfDisplayIdToOutput = new Map<string, { output: Deferred<NotebookCellOutput>; cell: NotebookCell }>();
            this.displayIdCellOutputMappingPerDocument.set(cell.notebook, mapOfDisplayIdToOutput);
        }
        mapOfDisplayIdToOutput.set(displayId, { output: displayOutputAdded, cell: cell });
        this.cellToDisplayIdMapping.set(cell, displayId);
        return displayOutputAdded;
    }
    /**
     * We return a promise, as we need to wait until the output is part of the DOM before we can update it.
     */
    public getMappedOutput(notebook: NotebookDocument, displayId: string): Promise<NotebookCellOutput> | undefined {
        const mapOfDisplayIdToOutput = this.displayIdCellOutputMappingPerDocument.get(notebook);
        if (!mapOfDisplayIdToOutput) {
            return;
        }
        // Check if the cell still exists.
        const mapping = mapOfDisplayIdToOutput.get(displayId);
        if (!mapping?.cell.document.isClosed) {
            return mapping?.output.promise;
        }
    }
}
