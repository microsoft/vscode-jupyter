// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { IKernelProvider } from '../types';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { KernelFileRenameHandler } from '../kernelFileRenameHandler';

suite('Kernel File Rename Handler', () => {
    let kernelProvider: IKernelProvider;
    let controllerRegistration: IControllerRegistration;
    let disposableRegistry: IDisposableRegistry;
    let handler: KernelFileRenameHandler;

    setup(() => {
        kernelProvider = mock<IKernelProvider>();
        controllerRegistration = mock<IControllerRegistration>();
        disposableRegistry = mock<IDisposableRegistry>();
        
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

        // Access private method for testing
        const isNotebookFile = (handler as any).isNotebookFile;

        // Assert
        assert.isTrue(isNotebookFile(notebookUri));
        assert.isFalse(isNotebookFile(pythonUri));
    });
});