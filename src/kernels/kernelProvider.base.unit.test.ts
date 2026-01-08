// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { NotebookDocument, Uri } from 'vscode';
import { IAsyncDisposableRegistry, IDisposableRegistry } from '../platform/common/types';
import { IKernel, KernelOptions } from './types';
import { BaseCoreKernelProvider } from './kernelProvider.base';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Test interface to add migration properties
interface ITestKernel extends IKernel {
    _migrationTarget?: string;
}

// Create a concrete test class since BaseCoreKernelProvider is abstract
class TestKernelProvider extends BaseCoreKernelProvider {
    public getOrCreate(_notebook: NotebookDocument, _options: KernelOptions): IKernel {
        throw new Error('Not implemented for test');
    }

    // Expose protected methods for testing
    public testDisposeOldKernel(notebook: NotebookDocument, reason: 'notebookClosed' | 'createNewKernel') {
        return this.disposeOldKernel(notebook, reason);
    }

    public testMigrateKernel(
        oldNotebook: NotebookDocument,
        newNotebook: NotebookDocument,
        kernel: IKernel,
        options: KernelOptions
    ) {
        return this.migrateKernel(oldNotebook, newNotebook, kernel, options);
    }

    // Override storeKernel to make it accessible for testing
    public testStoreKernel(notebook: NotebookDocument, options: KernelOptions, kernel: IKernel) {
        return this.storeKernel(notebook, options, kernel);
    }
}

suite('BaseCoreKernelProvider Kernel Migration', () => {
    let kernelProvider: TestKernelProvider;
    let asyncDisposables: IAsyncDisposableRegistry;
    let disposables: IDisposableRegistry;

    setup(() => {
        asyncDisposables = mock<IAsyncDisposableRegistry>();
        disposables = mock<IDisposableRegistry>();

        when(asyncDisposables.push(anything())).thenReturn();
        when(disposables.push(anything())).thenReturn();

        kernelProvider = new TestKernelProvider(instance(asyncDisposables), instance(disposables));
    });

    test('Should migrate kernel when marked for migration', () => {
        const oldNotebook = mock<NotebookDocument>();
        const newNotebook = mock<NotebookDocument>();
        // Create a simple mock kernel object
        const kernel = {
            id: 'test-kernel-id',
            _migrationTarget: undefined
        } as ITestKernel;
        const options = {} as KernelOptions;

        const oldUri = Uri.file('/test/old.ipynb');
        const newUri = Uri.file('/test/new.ipynb');

        when(oldNotebook.uri).thenReturn(oldUri);
        when(newNotebook.uri).thenReturn(newUri);

        // Store a kernel first
        kernelProvider.testStoreKernel(instance(oldNotebook), options, kernel);

        // Mark the kernel for migration
        kernel._migrationTarget = newUri.toString();

        // Test the migration directly by calling migrateKernel
        kernelProvider.testMigrateKernel(instance(oldNotebook), instance(newNotebook), kernel, options);

        // Assert - kernel should be accessible via new notebook
        const migratedKernel = kernelProvider.get(instance(newNotebook));
        assert.strictEqual(migratedKernel, kernel);

        // Assert - migration flag should be cleared
        assert.isUndefined(kernel._migrationTarget, 'Migration flag should be cleared');
    });

    test('Should not migrate kernel when not marked for migration', () => {
        const oldNotebook = mock<NotebookDocument>();
        const kernel = {
            id: 'test-kernel-id',
            dispose: () => Promise.resolve()
        } as IKernel;
        const options = {} as KernelOptions;

        const oldUri = Uri.file('/test/old.ipynb');
        when(oldNotebook.uri).thenReturn(oldUri);
        when(oldNotebook.isClosed).thenReturn(true);

        // Store a kernel first
        kernelProvider.testStoreKernel(instance(oldNotebook), options, kernel);

        // Don't mark for migration

        // Act - dispose old kernel (should dispose normally)
        kernelProvider.testDisposeOldKernel(instance(oldNotebook), 'notebookClosed');

        // Assert - kernel should no longer be in the provider
        const disposedKernel = kernelProvider.get(instance(oldNotebook));
        assert.isUndefined(disposedKernel);
    });

    test('Should directly migrate kernel when migrateKernel is called', () => {
        const oldNotebook = mock<NotebookDocument>();
        const newNotebook = mock<NotebookDocument>();
        const kernel = {
            id: 'test-kernel-id',
            _migrationTarget: undefined,
            notebook: undefined as any,
            uri: undefined as any
        } as ITestKernel & { notebook: any; uri: any };
        const options = {} as KernelOptions;

        const oldUri = Uri.file('/test/old.ipynb');
        const newUri = Uri.file('/test/new.ipynb');

        when(oldNotebook.uri).thenReturn(oldUri);
        when(newNotebook.uri).thenReturn(newUri);

        // Store a kernel first
        kernelProvider.testStoreKernel(instance(oldNotebook), options, kernel);

        // Mark for migration and set up kernel properties
        kernel._migrationTarget = newUri.toString();
        kernel.notebook = instance(oldNotebook);
        kernel.uri = oldUri;

        // Act - directly call migrate
        kernelProvider.testMigrateKernel(instance(oldNotebook), instance(newNotebook), kernel, options);

        // Assert - kernel should be accessible via new notebook
        const migratedKernel = kernelProvider.get(instance(newNotebook));
        assert.strictEqual(migratedKernel, kernel);

        // Assert - kernel should no longer be accessible via old notebook
        const oldKernel = kernelProvider.get(instance(oldNotebook));
        assert.isUndefined(oldKernel);

        // Assert - migration flag should be cleared
        assert.isUndefined(kernel._migrationTarget, 'Migration flag should be cleared');

        // Assert - kernel properties should be updated
        assert.strictEqual(kernel.notebook, instance(newNotebook));
        assert.strictEqual(kernel.uri, newUri);
    });
});
