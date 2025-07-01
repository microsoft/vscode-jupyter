// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { anything, instance, mock, when, verify, reset } from 'ts-mockito';
import { InstallPackagesTool } from './installPackageTool.node';
import { IKernelProvider } from '../../kernels/types';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { IInstallationChannelManager } from '../../platform/interpreter/installer/types';

suite('InstallPackagesTool Unit Tests', () => {
    let installPackagesTool: InstallPackagesTool;
    let kernelProvider: IKernelProvider;
    let controllerRegistration: IControllerRegistration;
    let installationManager: IInstallationChannelManager;
    
    // Mock VS Code objects
    let mockNotebook: vscode.NotebookDocument;
    let mockWorkspace: typeof vscode.workspace;
    let mockCells: vscode.NotebookCell[];

    setup(() => {
        kernelProvider = mock<IKernelProvider>();
        controllerRegistration = mock<IControllerRegistration>();
        installationManager = mock<IInstallationChannelManager>();
        
        // Create mock notebook and cells
        mockNotebook = {
            uri: vscode.Uri.file('/test/notebook.ipynb'),
            getCells: sinon.stub()
        } as any;
        
        mockCells = [];
        (mockNotebook.getCells as sinon.SinonStub).returns(mockCells);
        
        // Mock vscode.workspace
        mockWorkspace = {
            notebookDocuments: [mockNotebook],
            onDidChangeNotebookDocument: sinon.stub().returns({ dispose: sinon.stub() })
        } as any;
        
        // Replace the actual workspace with our mock
        sinon.stub(vscode, 'workspace').value(mockWorkspace);
    });

    teardown(() => {
        if (installPackagesTool) {
            installPackagesTool.dispose();
        }
        sinon.restore();
        reset(kernelProvider);
        reset(controllerRegistration);
        reset(installationManager);
    });

    test('Should initialize without executed cells', () => {
        // Create tool with no executed cells
        installPackagesTool = new InstallPackagesTool(
            instance(kernelProvider),
            instance(controllerRegistration),
            instance(installationManager)
        );
        
        // hasExecutedCells should return false for notebook with no executed cells
        const hasExecuted = (installPackagesTool as any).hasExecutedCells(mockNotebook);
        assert.isFalse(hasExecuted, 'Should return false for notebook with no executed cells');
    });

    test('Should not detect already executed cells during initialization', () => {
        // Setup notebook with executed cells
        const mockExecutedCell = {
            kind: vscode.NotebookCellKind.Code,
            executionSummary: { executionOrder: 1 }
        } as vscode.NotebookCell;
        
        mockCells.push(mockExecutedCell);
        
        // Create tool - should not detect already executed cells during initialization
        installPackagesTool = new InstallPackagesTool(
            instance(kernelProvider),
            instance(controllerRegistration),
            instance(installationManager)
        );
        
        // hasExecutedCells should return false since we no longer check during initialization
        const hasExecuted = (installPackagesTool as any).hasExecutedCells(mockNotebook);
        assert.isFalse(hasExecuted, 'Should return false since initialization does not check for executed cells');
    });

    test('Should not detect cells with execution order 0', () => {
        // Setup notebook with cell that has execution order 0 (not executed)
        const mockNonExecutedCell = {
            kind: vscode.NotebookCellKind.Code,
            executionSummary: { executionOrder: 0 }
        } as vscode.NotebookCell;
        
        mockCells.push(mockNonExecutedCell);
        
        installPackagesTool = new InstallPackagesTool(
            instance(kernelProvider),
            instance(controllerRegistration),
            instance(installationManager)
        );
        
        // hasExecutedCells should return false for cell with execution order 0
        const hasExecuted = (installPackagesTool as any).hasExecutedCells(mockNotebook);
        assert.isFalse(hasExecuted, 'Should return false for cell with execution order 0');
    });

    test('Should track cell execution via event listener', () => {
        let onDidChangeCallback: (e: vscode.NotebookDocumentChangeEvent) => void;
        
        // Capture the callback passed to onDidChangeNotebookDocument
        (mockWorkspace.onDidChangeNotebookDocument as sinon.SinonStub).callsFake((callback) => {
            onDidChangeCallback = callback;
            return { dispose: sinon.stub() };
        });
        
        installPackagesTool = new InstallPackagesTool(
            instance(kernelProvider),
            instance(controllerRegistration),
            instance(installationManager)
        );
        
        // Initially no executed cells
        assert.isFalse((installPackagesTool as any).hasExecutedCells(mockNotebook));
        
        // Simulate cell execution event
        const mockExecutedCell = {
            kind: vscode.NotebookCellKind.Code,
            executionSummary: { executionOrder: 1 }
        } as vscode.NotebookCell;
        
        const changeEvent: vscode.NotebookDocumentChangeEvent = {
            notebook: mockNotebook,
            cellChanges: [{
                cell: mockExecutedCell,
                document: undefined,
                executionSummary: undefined,
                metadata: undefined,
                outputs: undefined
            }],
            contentChanges: []
        };
        
        // Trigger the event
        onDidChangeCallback(changeEvent);
        
        // Now should detect executed cells
        assert.isTrue((installPackagesTool as any).hasExecutedCells(mockNotebook));
    });

    test('Should ignore non-code cells in execution tracking', () => {
        let onDidChangeCallback: (e: vscode.NotebookDocumentChangeEvent) => void;
        
        (mockWorkspace.onDidChangeNotebookDocument as sinon.SinonStub).callsFake((callback) => {
            onDidChangeCallback = callback;
            return { dispose: sinon.stub() };
        });
        
        installPackagesTool = new InstallPackagesTool(
            instance(kernelProvider),
            instance(controllerRegistration),
            instance(installationManager)
        );
        
        // Simulate markdown cell change
        const mockMarkdownCell = {
            kind: vscode.NotebookCellKind.Markup,
            executionSummary: { executionOrder: 1 }
        } as vscode.NotebookCell;
        
        const changeEvent: vscode.NotebookDocumentChangeEvent = {
            notebook: mockNotebook,
            cellChanges: [{
                cell: mockMarkdownCell,
                document: undefined,
                executionSummary: undefined,
                metadata: undefined,
                outputs: undefined
            }],
            contentChanges: []
        };
        
        onDidChangeCallback(changeEvent);
        
        // Should still return false since only non-code cells were changed
        assert.isFalse((installPackagesTool as any).hasExecutedCells(mockNotebook));
    });



    test('Should dispose of event listeners properly', () => {
        const disposeSpy = sinon.spy();
        (mockWorkspace.onDidChangeNotebookDocument as sinon.SinonStub).returns({ dispose: disposeSpy });
        
        installPackagesTool = new InstallPackagesTool(
            instance(kernelProvider),
            instance(controllerRegistration),
            instance(installationManager)
        );
        
        installPackagesTool.dispose();
        
        // Verify dispose was called
        assert.isTrue(disposeSpy.calledOnce, 'Event listener dispose should be called');
    });
});