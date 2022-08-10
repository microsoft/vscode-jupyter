// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { NotebookCell, NotebookCellOutput, NotebookDocument, workspace } from 'vscode';
import { isJupyterNotebook } from '../../platform/common/utils';

/**
 * Tracks a cell's display id. Some messages are sent to other cells and the display id is used to identify them.
 */
@injectable()
export class CellOutputDisplayIdTracker {
    private displayIdCellOutputMappingPerDocument = new WeakMap<
        NotebookDocument,
        Map<string, { output: NotebookCellOutput; cell: NotebookCell }>
    >();
    private cellToDisplayIdMapping = new WeakMap<NotebookCell, string>();
    constructor() {
        workspace.onDidChangeNotebookDocument((e) => {
            if (!isJupyterNotebook(e.notebook)) {
                return;
            }
            // We are only interested in cells that were cleared
            e.cellChanges
                .filter((change) => change.outputs?.length === 0)
                .map((change) => {
                    // If a cell was cleared, then remove the mapping, the output cannot exist anymore.
                    const displayIdToDelete = this.cellToDisplayIdMapping.get(change.cell);
                    if (displayIdToDelete) {
                        this.cellToDisplayIdMapping.delete(change.cell);
                        this.displayIdCellOutputMappingPerDocument.get(e.notebook)?.delete(displayIdToDelete);
                    }
                });
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
