// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Uri, FileRenameEvent } from 'vscode';
import { IKernel, IKernelProvider } from '../types';
import { IControllerRegistration, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { KernelFileRenameHandler } from '../kernelFileRenameHandler';

suite('Kernel File Rename Handler', () => {
    let kernelProvider: IKernelProvider;
    let controllerRegistration: IControllerRegistration;
    let disposableRegistry: IDisposableRegistry;
    let handler: KernelFileRenameHandler;
    let mockKernel: IKernel;
    let mockController: IVSCodeNotebookController;

    setup(() => {
        kernelProvider = mock<IKernelProvider>();
        controllerRegistration = mock<IControllerRegistration>();
        disposableRegistry = mock<IDisposableRegistry>();
        mockKernel = mock<IKernel>();
        mockController = mock<IVSCodeNotebookController>();
        
        handler = new KernelFileRenameHandler(
            instance(kernelProvider),
            instance(controllerRegistration),
            instance(disposableRegistry)
        );
    });

    test('Should register file rename listeners on activation', () => {
        // Act
        handler.activate();

        // Assert
        verify(disposableRegistry.push(anything())).twice();
    });

    test('Should identify notebook files correctly', () => {
        // Arrange
        const notebookUri = Uri.file('/path/to/notebook.ipynb');
        const pythonUri = Uri.file('/path/to/script.py');
        const uppercaseNotebookUri = Uri.file('/path/to/NOTEBOOK.IPYNB');

        // Access private method for testing
        const isNotebookFile = (handler as any).isNotebookFile;

        // Assert
        assert.isTrue(isNotebookFile(notebookUri));
        assert.isTrue(isNotebookFile(uppercaseNotebookUri));
        assert.isFalse(isNotebookFile(pythonUri));
    });

    test('Should store kernel for migration when preparing for rename', async () => {
        // Arrange
        const oldUri = Uri.file('/path/old.ipynb');
        const newUri = Uri.file('/path/new.ipynb');
        
        when(kernelProvider.get(oldUri)).thenReturn(instance(mockKernel));
        when(mockKernel.id).thenReturn('test-kernel-id');

        const event: FileRenameEvent = {
            files: [{ oldUri, newUri }]
        };

        // Act
        await (handler as any).prepareForFileRename(event);

        // Assert
        const pendingMigrations = (handler as any).pendingMigrations;
        assert.isTrue(pendingMigrations.has(oldUri.toString()));
        
        const migration = pendingMigrations.get(oldUri.toString());
        assert.isDefined(migration);
        assert.equal(migration.oldUri, oldUri);
        assert.equal(migration.newUri, newUri);
        assert.isDefined(migration.kernel);
    });

    test('Should not store kernel if none exists for old URI', async () => {
        // Arrange
        const oldUri = Uri.file('/path/old.ipynb');
        const newUri = Uri.file('/path/new.ipynb');
        
        when(kernelProvider.get(oldUri)).thenReturn(undefined);

        const event: FileRenameEvent = {
            files: [{ oldUri, newUri }]
        };

        // Act
        await (handler as any).prepareForFileRename(event);

        // Assert
        const pendingMigrations = (handler as any).pendingMigrations;
        assert.isFalse(pendingMigrations.has(oldUri.toString()));
    });

    test('Should skip non-notebook files during rename preparation', async () => {
        // Arrange
        const oldUri = Uri.file('/path/old.py');
        const newUri = Uri.file('/path/new.py');

        const event: FileRenameEvent = {
            files: [{ oldUri, newUri }]
        };

        // Act
        await (handler as any).prepareForFileRename(event);

        // Assert
        const pendingMigrations = (handler as any).pendingMigrations;
        assert.equal(pendingMigrations.size, 0);
        verify(kernelProvider.get(anything())).never();
    });
});