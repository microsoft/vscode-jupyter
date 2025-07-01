// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration test for InstallPackagesTool with CellExecutionTracker
 * This test verifies that the package installation tool correctly checks
 * cell execution state before prompting for kernel restart.
 */

import { expect } from 'chai';
import { mock, instance, when, verify, anything } from 'ts-mockito';
import * as vscode from 'vscode';
import { InstallPackagesTool } from '../../../standalone/chat/installPackageTool.node';
import { IKernelProvider } from '../../../kernels/types';
import { IControllerRegistration } from '../../../notebooks/controllers/types';
import { IInstallationChannelManager } from '../../../platform/interpreter/installer/types';
import { ICellExecutionTracker } from '../../../notebooks/types';

suite('InstallPackagesTool Integration', () => {
    let installPackagesTool: InstallPackagesTool;
    let mockKernelProvider: IKernelProvider;
    let mockControllerRegistration: IControllerRegistration;
    let mockInstallationManager: IInstallationChannelManager;
    let mockCellExecutionTracker: ICellExecutionTracker;
    let mockNotebook: vscode.NotebookDocument;

    setup(() => {
        mockKernelProvider = mock<IKernelProvider>();
        mockControllerRegistration = mock<IControllerRegistration>();
        mockInstallationManager = mock<IInstallationChannelManager>();
        mockCellExecutionTracker = mock<ICellExecutionTracker>();
        mockNotebook = mock<vscode.NotebookDocument>();

        installPackagesTool = new InstallPackagesTool(
            instance(mockKernelProvider),
            instance(mockControllerRegistration),
            instance(mockInstallationManager),
            instance(mockCellExecutionTracker)
        );

        // Setup mock notebook
        when(mockNotebook.uri).thenReturn({ toString: () => 'file:///test/notebook.ipynb' } as any);
    });

    test('Should not restart kernel when no cells have been executed', async () => {
        // Arrange
        const options = {
            input: {
                filePath: 'test/notebook.ipynb',
                packageList: ['numpy', 'pandas']
            }
        } as vscode.LanguageModelToolInvocationOptions<any>;

        const mockKernel = {
            kernelConnectionMetadata: {
                interpreter: { uri: 'python://path' },
                kind: 'startUsingPythonInterpreter'
            }
        };

        when(mockCellExecutionTracker.hasExecutedCells(anything())).thenReturn(false);
        
        // Mock successful package installation
        when(mockInstallationManager.getInstallationChannels(anything())).thenResolve([{
            installModule: () => Promise.resolve()
        }] as any);

        // Mock kernel setup functions
        const ensureKernelSelectedAndStarted = require('../../../standalone/chat/helper.node').ensureKernelSelectedAndStarted;
        const mockEnsureKernel = jest.spyOn({ ensureKernelSelectedAndStarted }, 'ensureKernelSelectedAndStarted')
            .mockResolvedValue(mockKernel);

        try {
            // Act
            const result = await installPackagesTool.invokeImpl(
                options,
                instance(mockNotebook),
                new vscode.CancellationTokenSource().token
            );

            // Assert
            verify(mockCellExecutionTracker.hasExecutedCells(anything())).once();
            expect(result.content).to.have.lengthOf(1);
            expect(result.content[0]).to.be.instanceOf(vscode.LanguageModelTextPart);
            
            const textPart = result.content[0] as vscode.LanguageModelTextPart;
            expect(textPart.value).to.include('The kernel was not restarted since no cells have been executed');
        } finally {
            mockEnsureKernel.mockRestore();
        }
    });

    // Additional test scenarios would go here...
    // Note: This is a conceptual test - the actual implementation would need
    // proper mocking of the vscode.lm.invokeTool function and other dependencies
});