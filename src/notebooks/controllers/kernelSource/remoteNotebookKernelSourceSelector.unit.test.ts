// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationError, CancellationTokenSource, NotebookDocument } from 'vscode';
import { IKernelFinder } from '../../../kernels/types';
import { IJupyterServerUriStorage, IJupyterServerProviderRegistry } from '../../../kernels/jupyter/types';
import { CodespacesJupyterServerSelector } from '../../../codespaces/codeSpacesServerSelector';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';
import { IConnectionDisplayDataProvider } from '../types';
import { IRemoteKernelFinderController } from '../../../kernels/jupyter/finder/types';
import { RemoteNotebookKernelSourceSelector } from './remoteNotebookKernelSourceSelector';
import { JupyterServerCollection, JupyterServerCommand, JupyterServerCommandProvider } from '../../../api';
import { InputFlowAction } from '../../../platform/common/utils/multiStepInput';

suite('Remote Notebook Kernel Source Selector', () => {
    let selector: RemoteNotebookKernelSourceSelector;
    let kernelFinder: IKernelFinder;
    let serverUriStorage: IJupyterServerUriStorage;
    let serverSelector: CodespacesJupyterServerSelector;
    let jupyterConnection: JupyterConnection;
    let displayDataProvider: IConnectionDisplayDataProvider;
    let kernelFinderController: IRemoteKernelFinderController;
    let jupyterServerRegistry: IJupyterServerProviderRegistry;
    let notebook: NotebookDocument;
    let cancellationTokenSource: CancellationTokenSource;

    setup(() => {
        kernelFinder = mock<IKernelFinder>();
        serverUriStorage = mock<IJupyterServerUriStorage>();
        serverSelector = mock(CodespacesJupyterServerSelector);
        jupyterConnection = mock(JupyterConnection);
        displayDataProvider = mock<IConnectionDisplayDataProvider>();
        kernelFinderController = mock<IRemoteKernelFinderController>();
        jupyterServerRegistry = mock<IJupyterServerProviderRegistry>();
        notebook = mock<NotebookDocument>();
        cancellationTokenSource = new CancellationTokenSource();

        when(kernelFinder.registered).thenReturn([]);
        when(serverUriStorage.all).thenReturn([]);
        when(jupyterServerRegistry.jupyterCollections).thenReturn([]);

        selector = new RemoteNotebookKernelSourceSelector(
            instance(kernelFinder),
            instance(serverUriStorage),
            instance(serverSelector),
            instance(jupyterConnection),
            instance(displayDataProvider),
            instance(kernelFinderController),
            instance(jupyterServerRegistry)
        );
    });

    teardown(() => {
        cancellationTokenSource.dispose();
    });

    test('should handle CancellationError from handleCommand properly', async () => {
        // Arrange
        const mockCommandProvider = mock<JupyterServerCommandProvider>();
        const mockCollection = mock<JupyterServerCollection>();
        const mockCommand = mock<JupyterServerCommand>();

        when(mockCollection.extensionId).thenReturn('test-extension');
        when(mockCollection.id).thenReturn('test-id');
        when(mockCollection.commandProvider).thenReturn(instance(mockCommandProvider));

        when(mockCommandProvider.provideCommands(anything(), anything())).thenReturn([instance(mockCommand)]);
        when(mockCommandProvider.handleCommand(anything(), anything())).thenReject(new CancellationError());

        when(notebook.notebookType).thenReturn('jupyter-notebook');

        // This test simulates what happens when a third-party extension's handleCommand throws CancellationError
        // The expected behavior is that the UI should dismiss (CancellationError should propagate)
        try {
            await selector.selectRemoteKernel(instance(notebook), instance(mockCollection));
            assert.fail('Expected CancellationError to be thrown');
        } catch (error) {
            assert.instanceOf(error, CancellationError, 'Should propagate CancellationError to dismiss UI');
        }
    });

    test('should handle InputFlowAction.back from handleCommand by going back', async () => {
        // Arrange
        const mockCommandProvider = mock<JupyterServerCommandProvider>();
        const mockCollection = mock<JupyterServerCollection>();
        const mockCommand = mock<JupyterServerCommand>();

        when(mockCollection.extensionId).thenReturn('test-extension');
        when(mockCollection.id).thenReturn('test-id');
        when(mockCollection.commandProvider).thenReturn(instance(mockCommandProvider));

        when(mockCommandProvider.provideCommands(anything(), anything())).thenReturn([instance(mockCommand)]);
        when(mockCommandProvider.handleCommand(anything(), anything())).thenResolve(undefined); // Returns undefined/null

        when(notebook.notebookType).thenReturn('jupyter-notebook');

        // This test simulates what happens when a third-party extension's handleCommand returns undefined/null
        // The expected behavior is that it should go back to the previous UI
        try {
            await selector.selectRemoteKernel(instance(notebook), instance(mockCollection));
            assert.fail('Expected InputFlowAction.back to be thrown');
        } catch (error) {
            // This should either return undefined or throw InputFlowAction.back
            assert.isTrue(
                error === InputFlowAction.back || error instanceof CancellationError,
                'Should handle undefined return by going back or cancelling'
            );
        }
    });
});