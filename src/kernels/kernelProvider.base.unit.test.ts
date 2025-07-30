// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { mock, when, instance, verify, anything } from 'ts-mockito';
import { NotebookDocument, Uri, workspace } from 'vscode';
import * as sinon from 'sinon';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../platform/common/types';
import { BaseCoreKernelProvider } from './kernelProvider.base';
import { IKernel, KernelOptions } from './types';

// Test implementation of abstract base class
class TestKernelProvider extends BaseCoreKernelProvider {
    private kernelStatesSaved: { kernel: IKernel; resourceUri: Uri }[] = [];
    private kernelStatesRemoved: string[] = [];

    constructor(
        asyncDisposables: IAsyncDisposableRegistry,
        disposables: IDisposableRegistry
    ) {
        super(asyncDisposables, disposables);
    }

    public getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel {
        const mockKernel = mock<IKernel>();
        when(mockKernel.id).thenReturn('test-kernel-' + Date.now());
        when(mockKernel.resourceUri).thenReturn(notebook.uri);
        when(mockKernel.notebook).thenReturn(notebook);
        when(mockKernel.onRestarted).thenReturn(() => ({ dispose: () => {} }));
        when(mockKernel.onDisposed).thenReturn(() => ({ dispose: () => {} }));
        when(mockKernel.onStarted).thenReturn(() => ({ dispose: () => {} }));
        when(mockKernel.onStatusChanged).thenReturn(() => ({ dispose: () => {} }));
        when(mockKernel.onPostInitialized).thenReturn(() => ({ dispose: () => {} }));

        const kernel = instance(mockKernel);
        this.storeKernel(notebook, options, kernel);
        this.deleteMappingIfKernelIsDisposed(kernel);
        return kernel;
    }

    protected async saveKernelStateForReconnection(kernel: IKernel, resourceUri: Uri): Promise<void> {
        this.kernelStatesSaved.push({ kernel, resourceUri });
    }

    protected async removeKernelStateFromPersistence(kernelId: string): Promise<void> {
        this.kernelStatesRemoved.push(kernelId);
    }

    // Test helpers
    public getSavedKernelStates() {
        return this.kernelStatesSaved;
    }

    public getRemovedKernelStates() {
        return this.kernelStatesRemoved;
    }

    public testShouldPreserveKernelsOnShutdown(): boolean {
        return this.shouldPreserveKernelsOnShutdown();
    }
}

suite('BaseCoreKernelProvider Unit Tests', () => {
    let disposables: IDisposable[] = [];
    let kernelProvider: TestKernelProvider;
    let mockAsyncDisposables: IAsyncDisposableRegistry;
    let mockDisposables: IDisposableRegistry;
    let mockNotebook: NotebookDocument;
    let workspaceStub: sinon.SinonStub;

    setup(() => {
        mockAsyncDisposables = mock<IAsyncDisposableRegistry>();
        mockDisposables = mock<IDisposableRegistry>();
        mockNotebook = mock<NotebookDocument>();

        // Setup notebook mock
        when(mockNotebook.uri).thenReturn(Uri.file('/test/notebook.ipynb'));
        when(mockNotebook.isClosed).thenReturn(false);

        // Setup mocks
        when(mockAsyncDisposables.push(anything())).thenReturn();
        when(mockDisposables.push(anything())).thenReturn();

        // Mock workspace configuration
        workspaceStub = sinon.stub(workspace, 'getConfiguration');

        kernelProvider = new TestKernelProvider(
            instance(mockAsyncDisposables),
            instance(mockDisposables)
        );
    });

    teardown(() => {
        disposables = dispose(disposables);
        sinon.restore();
    });

    suite('shouldPreserveKernelsOnShutdown', () => {
        test('Should return true when persistent sessions enabled and killOnDisconnect false', () => {
            // Arrange
            const mockConfig = {
                get: sinon.stub()
            };
            mockConfig.get.withArgs('enablePersistentSessions', true).returns(true);
            mockConfig.get.withArgs('kernels.killOnDisconnect', false).returns(false);
            workspaceStub.withArgs('jupyter').returns(mockConfig);

            // Act
            const shouldPreserve = kernelProvider.testShouldPreserveKernelsOnShutdown();

            // Assert
            assert.isTrue(shouldPreserve);
        });

        test('Should return false when persistent sessions disabled', () => {
            // Arrange
            const mockConfig = {
                get: sinon.stub()
            };
            mockConfig.get.withArgs('enablePersistentSessions', true).returns(false);
            mockConfig.get.withArgs('kernels.killOnDisconnect', false).returns(false);
            workspaceStub.withArgs('jupyter').returns(mockConfig);

            // Act
            const shouldPreserve = kernelProvider.testShouldPreserveKernelsOnShutdown();

            // Assert
            assert.isFalse(shouldPreserve);
        });

        test('Should return false when killOnDisconnect is true', () => {
            // Arrange
            const mockConfig = {
                get: sinon.stub()
            };
            mockConfig.get.withArgs('enablePersistentSessions', true).returns(true);
            mockConfig.get.withArgs('kernels.killOnDisconnect', false).returns(true);
            workspaceStub.withArgs('jupyter').returns(mockConfig);

            // Act
            const shouldPreserve = kernelProvider.testShouldPreserveKernelsOnShutdown();

            // Assert
            assert.isFalse(shouldPreserve);
        });

        test('Should return false when both settings disable preservation', () => {
            // Arrange
            const mockConfig = {
                get: sinon.stub()
            };
            mockConfig.get.withArgs('enablePersistentSessions', true).returns(false);
            mockConfig.get.withArgs('kernels.killOnDisconnect', false).returns(true);
            workspaceStub.withArgs('jupyter').returns(mockConfig);

            // Act
            const shouldPreserve = kernelProvider.testShouldPreserveKernelsOnShutdown();

            // Assert
            assert.isFalse(shouldPreserve);
        });
    });

    suite('dispose with kernel preservation', () => {
        test('Should save kernel states when preservation is enabled', async () => {
            // Arrange
            const mockConfig = {
                get: sinon.stub()
            };
            mockConfig.get.withArgs('enablePersistentSessions', true).returns(true);
            mockConfig.get.withArgs('kernels.killOnDisconnect', false).returns(false);
            workspaceStub.withArgs('jupyter').returns(mockConfig);

            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            // Create some kernels
            const kernel1 = kernelProvider.getOrCreate(instance(mockNotebook), options);
            const kernel2 = kernelProvider.getOrCreate(instance(mockNotebook), { ...options, metadata: { ...options.metadata, id: 'test2' } });

            // Act
            await kernelProvider.dispose();

            // Assert
            const savedStates = kernelProvider.getSavedKernelStates();
            assert.equal(savedStates.length, 2);
            assert.equal(savedStates[0].kernel, kernel1);
            assert.equal(savedStates[1].kernel, kernel2);
        });

        test('Should not save kernel states when preservation is disabled', async () => {
            // Arrange
            const mockConfig = {
                get: sinon.stub()
            };
            mockConfig.get.withArgs('enablePersistentSessions', true).returns(false);
            mockConfig.get.withArgs('kernels.killOnDisconnect', false).returns(false);
            workspaceStub.withArgs('jupyter').returns(mockConfig);

            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            // Create a kernel
            kernelProvider.getOrCreate(instance(mockNotebook), options);

            // Act
            await kernelProvider.dispose();

            // Assert
            const savedStates = kernelProvider.getSavedKernelStates();
            assert.equal(savedStates.length, 0);
        });

        test('Should handle save errors gracefully during disposal', async () => {
            // Arrange
            const mockConfig = {
                get: sinon.stub()
            };
            mockConfig.get.withArgs('enablePersistentSessions', true).returns(true);
            mockConfig.get.withArgs('kernels.killOnDisconnect', false).returns(false);
            workspaceStub.withArgs('jupyter').returns(mockConfig);

            // Override saveKernelStateForReconnection to throw an error
            const originalSave = kernelProvider['saveKernelStateForReconnection'];
            kernelProvider['saveKernelStateForReconnection'] = async () => {
                throw new Error('Save failed');
            };

            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            // Create a kernel
            kernelProvider.getOrCreate(instance(mockNotebook), options);

            // Act & Assert - should not throw
            await kernelProvider.dispose();

            // Restore original method
            kernelProvider['saveKernelStateForReconnection'] = originalSave;
        });
    });

    suite('kernel management', () => {
        test('Should store and retrieve kernels correctly', () => {
            // Arrange
            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            // Act
            const kernel = kernelProvider.getOrCreate(instance(mockNotebook), options);
            const retrievedKernel = kernelProvider.get(instance(mockNotebook));

            // Assert
            assert.equal(kernel, retrievedKernel);
        });

        test('Should replace kernel when getOrCreate called with different metadata', () => {
            // Arrange
            const options1: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test1' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };
            const options2: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test2' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            // Act
            const kernel1 = kernelProvider.getOrCreate(instance(mockNotebook), options1);
            const kernel2 = kernelProvider.getOrCreate(instance(mockNotebook), options2);

            // Assert
            assert.notEqual(kernel1, kernel2);
            assert.equal(kernelProvider.get(instance(mockNotebook)), kernel2);
        });

        test('Should return same kernel when getOrCreate called with same metadata', () => {
            // Arrange
            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            // Act
            const kernel1 = kernelProvider.getOrCreate(instance(mockNotebook), options);
            const kernel2 = kernelProvider.getOrCreate(instance(mockNotebook), options);

            // Assert
            assert.equal(kernel1, kernel2);
        });

        test('Should return kernels list correctly', () => {
            // Arrange - Mock workspace.notebookDocuments
            const notebookDocumentsStub = sinon.stub(workspace, 'notebookDocuments').value([instance(mockNotebook)]);
            
            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            // Act
            const kernel = kernelProvider.getOrCreate(instance(mockNotebook), options);
            const kernels = kernelProvider.kernels;

            // Assert
            assert.equal(kernels.length, 1);
            assert.equal(kernels[0], kernel);

            // Cleanup
            notebookDocumentsStub.restore();
        });

        test('Should retrieve kernel by ID', () => {
            // Arrange
            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            // Act
            const kernel = kernelProvider.getOrCreate(instance(mockNotebook), options);
            const retrievedKernel = kernelProvider.get(kernel.id);

            // Assert
            assert.equal(kernel, retrievedKernel);
        });

        test('Should retrieve kernel by URI', () => {
            // Arrange
            const notebookUri = Uri.file('/test/notebook.ipynb');
            const notebookDocumentsStub = sinon.stub(workspace, 'notebookDocuments').value([instance(mockNotebook)]);
            when(mockNotebook.uri).thenReturn(notebookUri);

            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: notebookUri
            };

            // Act
            const kernel = kernelProvider.getOrCreate(instance(mockNotebook), options);
            const retrievedKernel = kernelProvider.get(notebookUri);

            // Assert
            assert.equal(kernel, retrievedKernel);

            // Cleanup
            notebookDocumentsStub.restore();
        });
    });

    suite('kernel disposal handling', () => {
        test('Should clean up mappings when kernel is disposed', () => {
            // Arrange
            const options: KernelOptions = {
                metadata: { kind: 'startUsingLocalKernelSpec', id: 'test' } as any,
                controller: { id: 'test-controller' } as any,
                resourceUri: Uri.file('/test/notebook.ipynb')
            };

            const kernel = kernelProvider.getOrCreate(instance(mockNotebook), options);
            
            // Mock kernel disposal
            const mockKernelImpl = kernel as any;
            const disposedHandlers: Array<() => void> = [];
            mockKernelImpl.onDisposed = (handler: () => void) => {
                disposedHandlers.push(handler);
                return { dispose: () => {} };
            };

            // Trigger the disposal handling setup
            kernelProvider['deleteMappingIfKernelIsDisposed'](kernel);

            // Act - simulate kernel disposal
            disposedHandlers.forEach(handler => handler());

            // Assert
            assert.isUndefined(kernelProvider.get(instance(mockNotebook)));
            assert.isUndefined(kernelProvider.get(kernel.id));
        });
    });
});