// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCell, NotebookCellOutput, NotebookCellOutputItem, NotebookDocument, workspace } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { dispose } from '../../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { isJupyterNotebook } from '../../platform/common/utils';

/**
 * Tracks a cell's display id. Some messages are sent to other cells and the display id is used to identify them.
 */
@injectable()
export class CellOutputDisplayIdTracker implements IExtensionSyncActivationService {
    private static displayIdCellOutputMappingPerDocument = new WeakMap<
        NotebookDocument,
        Map<string, { outputContainer: NotebookCellOutput; outputItems: NotebookCellOutputItem[]; cell: NotebookCell }>
    >();
    private static cellToDisplayIdMapping = new WeakMap<NotebookCell, string>();
    private static disposables: IDisposable[] = [];
    public static dispose() {
        dispose(CellOutputDisplayIdTracker.disposables);
    }
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        disposables.push({
            dispose: () => {
                CellOutputDisplayIdTracker.dispose();
            }
        });
    }
    public activate(): void {
        workspace.onDidChangeNotebookDocument((e) => {
            if (!isJupyterNotebook(e.notebook)) {
                return;
            }
            // We are only interested in cells that were cleared
            e.cellChanges
                .filter((change) => change.outputs?.length === 0)
                .map((change) => {
                    // If a cell was cleared, then remove the mapping, the output cannot exist anymore.
                    const displayIdToDelete = CellOutputDisplayIdTracker.cellToDisplayIdMapping.get(change.cell);
                    if (displayIdToDelete) {
                        CellOutputDisplayIdTracker.cellToDisplayIdMapping.delete(change.cell);
                        CellOutputDisplayIdTracker.displayIdCellOutputMappingPerDocument
                            .get(e.notebook)
                            ?.delete(displayIdToDelete);
                    }
                });
        });
    }
    /**
     * Keep track of the mapping between display_id and the output.
     * When we need to update this display, we can resolve the promise & access the output.
     * The return value is a promise that needs to be resolved with the associated output thats been added to the DOM
     */
    public static trackOutputByDisplayId(
        cell: NotebookCell,
        displayId: string,
        outputContainer: NotebookCellOutput,
        outputItems: NotebookCellOutputItem[]
    ) {
        let mapOfDisplayIdToOutput = CellOutputDisplayIdTracker.displayIdCellOutputMappingPerDocument.get(
            cell.notebook
        );
        if (!mapOfDisplayIdToOutput) {
            mapOfDisplayIdToOutput = new Map<
                string,
                { outputContainer: NotebookCellOutput; outputItems: NotebookCellOutputItem[]; cell: NotebookCell }
            >();
            CellOutputDisplayIdTracker.displayIdCellOutputMappingPerDocument.set(cell.notebook, mapOfDisplayIdToOutput);
        }
        mapOfDisplayIdToOutput.set(displayId, { outputContainer, cell, outputItems });
        CellOutputDisplayIdTracker.cellToDisplayIdMapping.set(cell, displayId);
    }
    /**
     * We return a promise, as we need to wait until the output is part of the DOM before we can update it.
     */
    public static getMappedOutput(
        notebook: NotebookDocument,
        displayId: string
    ): { cell: NotebookCell; outputContainer: NotebookCellOutput; outputItems: NotebookCellOutputItem[] } | undefined {
        const mapOfDisplayIdToOutput = CellOutputDisplayIdTracker.displayIdCellOutputMappingPerDocument.get(notebook);
        if (!mapOfDisplayIdToOutput) {
            return;
        }
        // Check if the cell still exists.
        const mapping = mapOfDisplayIdToOutput.get(displayId);
        return mapping?.cell.document.isClosed ? undefined : mapping;
    }
}
