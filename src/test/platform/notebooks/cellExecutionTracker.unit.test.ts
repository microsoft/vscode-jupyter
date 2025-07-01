// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { NotebookDocument, NotebookCell } from 'vscode';
import { mock, instance, when } from 'ts-mockito';
import { CellExecutionTracker } from '../../../platform/notebooks/cellExecutionTracker';
import { NotebookCellExecutionState } from '../../../platform/notebooks/cellExecutionStateService';

suite('Cell Execution Tracker', () => {
    let cellExecutionTracker: CellExecutionTracker;
    let mockNotebook: NotebookDocument;
    let mockCell: NotebookCell;

    setup(() => {
        cellExecutionTracker = new CellExecutionTracker();
        mockNotebook = mock<NotebookDocument>();
        mockCell = mock<NotebookCell>();
        
        // Setup mock notebook URI
        when(mockNotebook.uri).thenReturn({ toString: () => 'file:///test/notebook.ipynb' } as any);
        when(mockCell.notebook).thenReturn(instance(mockNotebook));
    });

    test('Should initially return false for hasExecutedCells', () => {
        const notebook = instance(mockNotebook);
        const result = cellExecutionTracker.hasExecutedCells(notebook);
        expect(result).to.be.false;
    });

    test('Should return true after a cell execution completes', () => {
        const notebook = instance(mockNotebook);
        const cell = instance(mockCell);
        
        // Mock cell execution summary
        when(mockCell.executionSummary).thenReturn({ executionOrder: 1 });
        
        // Trigger cell execution state change
        cellExecutionTracker['onDidChangeNotebookCellExecutionState']({
            cell: cell,
            state: NotebookCellExecutionState.Idle
        });
        
        const result = cellExecutionTracker.hasExecutedCells(notebook);
        expect(result).to.be.true;
    });

    test('Should not mark as executed if cell has no execution order', () => {
        const notebook = instance(mockNotebook);
        const cell = instance(mockCell);
        
        // Mock cell with no execution summary
        when(mockCell.executionSummary).thenReturn(undefined);
        
        // Trigger cell execution state change
        cellExecutionTracker['onDidChangeNotebookCellExecutionState']({
            cell: cell,
            state: NotebookCellExecutionState.Idle
        });
        
        const result = cellExecutionTracker.hasExecutedCells(notebook);
        expect(result).to.be.false;
    });

    test('Should not mark as executed if cell is not in Idle state', () => {
        const notebook = instance(mockNotebook);
        const cell = instance(mockCell);
        
        // Mock cell execution summary
        when(mockCell.executionSummary).thenReturn({ executionOrder: 1 });
        
        // Trigger cell execution state change with Executing state
        cellExecutionTracker['onDidChangeNotebookCellExecutionState']({
            cell: cell,
            state: NotebookCellExecutionState.Executing
        });
        
        const result = cellExecutionTracker.hasExecutedCells(notebook);
        expect(result).to.be.false;
    });

    test('Should reset execution state when resetExecutionState is called', () => {
        const notebook = instance(mockNotebook);
        const cell = instance(mockCell);
        
        // Mock cell execution summary
        when(mockCell.executionSummary).thenReturn({ executionOrder: 1 });
        
        // First, mark as executed
        cellExecutionTracker['onDidChangeNotebookCellExecutionState']({
            cell: cell,
            state: NotebookCellExecutionState.Idle
        });
        
        expect(cellExecutionTracker.hasExecutedCells(notebook)).to.be.true;
        
        // Reset execution state
        cellExecutionTracker.resetExecutionState(notebook);
        
        const result = cellExecutionTracker.hasExecutedCells(notebook);
        expect(result).to.be.false;
    });

    test('Should handle multiple notebooks independently', () => {
        // Create second mock notebook
        const mockNotebook2 = mock<NotebookDocument>();
        when(mockNotebook2.uri).thenReturn({ toString: () => 'file:///test/notebook2.ipynb' } as any);
        
        const notebook1 = instance(mockNotebook);
        const notebook2 = instance(mockNotebook2);
        const cell = instance(mockCell);
        
        // Mock cell execution summary
        when(mockCell.executionSummary).thenReturn({ executionOrder: 1 });
        
        // Execute cell in notebook1
        cellExecutionTracker['onDidChangeNotebookCellExecutionState']({
            cell: cell,
            state: NotebookCellExecutionState.Idle
        });
        
        // notebook1 should have executed cells, notebook2 should not
        expect(cellExecutionTracker.hasExecutedCells(notebook1)).to.be.true;
        expect(cellExecutionTracker.hasExecutedCells(notebook2)).to.be.false;
        
        // Reset notebook1
        cellExecutionTracker.resetExecutionState(notebook1);
        
        // Both should now be false
        expect(cellExecutionTracker.hasExecutedCells(notebook1)).to.be.false;
        expect(cellExecutionTracker.hasExecutedCells(notebook2)).to.be.false;
    });
});