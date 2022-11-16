// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { EventEmitter, NotebookCellExecutionStateChangeEvent, NotebookController, NotebookDocument, Uri } from 'vscode';
import { CellOutputDisplayIdTracker } from '../../kernels/execution/cellDisplayIdTracker';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { KernelProvider, ThirdPartyKernelProvider } from '../../kernels/kernelProvider.node';
import {
    IThirdPartyKernelProvider,
    INotebookProvider,
    KernelConnectionMetadata,
    KernelOptions,
    IKernelProvider
} from '../../kernels/types';
import { IApplicationShell, IVSCodeNotebook } from '../../platform/common/application/types';
import { AsyncDisposableRegistry } from '../../platform/common/asyncDisposableRegistry';
import { JupyterNotebookView } from '../../platform/common/constants';
import { disposeAllDisposables } from '../../platform/common/helpers';
import {
    IConfigurationService,
    IDisposable,
    IExtensionContext,
    IWatchableJupyterSettings
} from '../../platform/common/types';
import { createEventHandler } from '../common.node';
import { mockedVSCodeNamespaces } from '../vscode-mock';

suite('KernelProvider Node', () => {
    const disposables: IDisposable[] = [];
    let asyncDisposables: AsyncDisposableRegistry;
    let kernelProvider: IKernelProvider;
    let thirdPartyKernelProvider: IThirdPartyKernelProvider;
    let notebookProvider: INotebookProvider;
    let configService: IConfigurationService;
    let appShell: IApplicationShell;
    let vscNotebook: IVSCodeNotebook;
    let jupyterServerUriStorage: IJupyterServerUriStorage;
    let context: IExtensionContext;
    let onDidCloseNotebookDocument: EventEmitter<NotebookDocument>;
    const sampleUri1 = Uri.file('sample1.ipynb');
    const sampleUri2 = Uri.file('sample2.ipynb');
    const sampleUri3 = Uri.file('sample3.ipynb');
    let sampleNotebook1: NotebookDocument;
    let sampleNotebook2: NotebookDocument;
    let sampleNotebook3: NotebookDocument;
    setup(() => {
        sampleNotebook1 = mock<NotebookDocument>();
        when(sampleNotebook1.uri).thenReturn(sampleUri1);
        when(sampleNotebook1.notebookType).thenReturn(JupyterNotebookView);
        sampleNotebook2 = mock<NotebookDocument>();
        when(sampleNotebook2.uri).thenReturn(sampleUri2);
        when(sampleNotebook2.notebookType).thenReturn(JupyterNotebookView);
        sampleNotebook3 = mock<NotebookDocument>();
        when(sampleNotebook3.uri).thenReturn(sampleUri3);
        when(sampleNotebook3.notebookType).thenReturn(JupyterNotebookView);
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([
            instance(sampleNotebook1),
            instance(sampleNotebook2),
            instance(sampleNotebook3)
        ]);

        onDidCloseNotebookDocument = new EventEmitter<NotebookDocument>();
        disposables.push(onDidCloseNotebookDocument);
        asyncDisposables = new AsyncDisposableRegistry();
        notebookProvider = mock<INotebookProvider>();
        configService = mock<IConfigurationService>();
        appShell = mock<IApplicationShell>();
        vscNotebook = mock<IVSCodeNotebook>();
        jupyterServerUriStorage = mock<IJupyterServerUriStorage>();
        context = mock<IExtensionContext>();
        const onDidChangeNotebookCellExecutionState = new EventEmitter<NotebookCellExecutionStateChangeEvent>();
        disposables.push(onDidChangeNotebookCellExecutionState);
        const configSettings = mock<IWatchableJupyterSettings>();
        const onDidChangeNotebookCellExecutionState = new EventEmitter<NotebookCellExecutionStateChangeEvent>();
        disposables.push(onDidChangeNotebookCellExecutionState);
        when(mockedVSCodeNamespaces.notebooks.onDidChangeNotebookCellExecutionState).thenReturn(
            onDidChangeNotebookCellExecutionState.event
        );
        when(vscNotebook.onDidCloseNotebookDocument).thenReturn(onDidCloseNotebookDocument.event);
        when(mockedVSCodeNamespaces.notebooks.onDidChangeNotebookCellExecutionState).thenReturn(
            onDidChangeNotebookCellExecutionState.event
        );
        when(configService.getSettings(anything())).thenReturn(instance(configSettings));
        when(vscNotebook.notebookDocuments).thenReturn([
            instance(sampleNotebook1),
            instance(sampleNotebook2),
            instance(sampleNotebook3)
        ]);

        kernelProvider = new KernelProvider(
            asyncDisposables,
            disposables,
            instance(notebookProvider),
            instance(configService),
            instance(appShell),
            instance(vscNotebook),
            instance(context),
            instance(jupyterServerUriStorage),
            [],
            []
        );
        thirdPartyKernelProvider = new ThirdPartyKernelProvider(
            asyncDisposables,
            disposables,
            instance(notebookProvider),
            instance(configService),
            instance(appShell),
            instance(vscNotebook),
            []
        );
    });
    teardown(async () => {
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([]);
        CellOutputDisplayIdTracker.dispose();
        disposeAllDisposables(disposables);
        await asyncDisposables.dispose();
    });
    test('Test creation, getting current instance and triggering of events', async () => {
        const metadata = mock<KernelConnectionMetadata>();
        when(metadata.id).thenReturn('xyz');
        const options: KernelOptions = {
            controller: instance(mock<NotebookController>()),
            metadata: instance(metadata),
            resourceUri: sampleUri1
        };

        assert.isUndefined(kernelProvider.get(sampleUri1), 'Should not return an instance');
        assert.isUndefined(kernelProvider.get(sampleUri2), 'Should not return an instance');
        assert.isUndefined(kernelProvider.get(sampleUri3), 'Should not return an instance');

        const onKernelCreated = createEventHandler(kernelProvider, 'onDidCreateKernel', disposables);
        const onKernelDisposed = createEventHandler(kernelProvider, 'onDidDisposeKernel', disposables);
        const kernel = kernelProvider.getOrCreate(instance(sampleNotebook1), options);
        asyncDisposables.push(kernel);

        assert.equal(kernel.uri, sampleUri1, 'Kernel id should match the uri');
        assert.isUndefined(kernelProvider.get(sampleUri2), 'Should not return an instance');
        assert.isUndefined(kernelProvider.get(sampleUri3), 'Should not return an instance');
        assert.equal(onKernelCreated.count, 1, 'Should have triggered the event');
        assert.equal(onKernelDisposed.count, 0, 'Should not have triggered the event');
        assert.isOk(kernel, 'Should be an object');
        assert.equal(kernel, kernelProvider.get(sampleUri1), 'Should return the same instance');
        assert.equal(
            kernel,
            kernelProvider.getOrCreate(instance(sampleNotebook1), options),
            'Should return the same instance'
        );

        await kernel.dispose();
        assert.isTrue(kernel.disposed, 'Kernel should be disposed');
        assert.equal(onKernelDisposed.count, 1, 'Should have triggered the disposed event');
        assert.equal(onKernelDisposed.first, kernel, 'Incorrect disposed event arg');

        assert.isUndefined(kernelProvider.get(sampleUri1), 'Should not return an instance');
        assert.isUndefined(kernelProvider.get(sampleUri2), 'Should not return an instance');
        assert.isUndefined(kernelProvider.get(sampleUri3), 'Should not return an instance');
    });
    test('Test creation of kernels for 3rd party', async () => {
        const metadata = mock<KernelConnectionMetadata>();
        const uri = Uri.file('sample.csv');
        when(metadata.id).thenReturn('xyz');
        const options: KernelOptions = {
            controller: instance(mock<NotebookController>()),
            metadata: instance(metadata),
            resourceUri: uri
        };

        assert.isUndefined(thirdPartyKernelProvider.get(uri), 'Should not return an instance');
        assert.isUndefined(thirdPartyKernelProvider.get(sampleUri1), 'Should not return an instance');
        assert.isUndefined(thirdPartyKernelProvider.get(sampleUri2), 'Should not return an instance');
        assert.isUndefined(thirdPartyKernelProvider.get(sampleUri3), 'Should not return an instance');

        const onKernelCreated = createEventHandler(thirdPartyKernelProvider, 'onDidCreateKernel', disposables);
        const onKernelDisposed = createEventHandler(thirdPartyKernelProvider, 'onDidDisposeKernel', disposables);
        const kernel = thirdPartyKernelProvider.getOrCreate(uri, options);
        asyncDisposables.push(kernel);

        assert.equal(kernel.uri, uri, 'Kernel id should match the uri');
        assert.isUndefined(thirdPartyKernelProvider.get(sampleUri2), 'Should not return an instance');
        assert.isUndefined(thirdPartyKernelProvider.get(sampleUri3), 'Should not return an instance');
        assert.equal(onKernelCreated.count, 1, 'Should have triggered the event');
        assert.equal(onKernelDisposed.count, 0, 'Should not have triggered the event');
        assert.isOk(kernel, 'Should be an object');
        assert.equal(kernel, thirdPartyKernelProvider.get(uri), 'Should return the same instance');
        assert.equal(kernel, thirdPartyKernelProvider.getOrCreate(uri, options), 'Should return the same instance');

        await kernel.dispose();
        assert.isTrue(kernel.disposed, 'Kernel should be disposed');
        assert.equal(onKernelDisposed.count, 1, 'Should have triggered the disposed event');
        assert.equal(onKernelDisposed.first, kernel, 'Incorrect disposed event arg');

        assert.isUndefined(thirdPartyKernelProvider.get(sampleUri1), 'Should not return an instance');
        assert.isUndefined(thirdPartyKernelProvider.get(sampleUri2), 'Should not return an instance');
        assert.isUndefined(thirdPartyKernelProvider.get(sampleUri3), 'Should not return an instance');
    });
    test('When kernel is disposed a new kernel should be returned when calling getOrCreate', async () => {
        const metadata = mock<KernelConnectionMetadata>();
        when(metadata.id).thenReturn('xyz');
        const options: KernelOptions = {
            controller: instance(mock<NotebookController>()),
            metadata: instance(metadata),
            resourceUri: sampleUri1
        };

        // Dispose the first kernel
        const kernel = kernelProvider.getOrCreate(instance(sampleNotebook1), options);
        await kernel.dispose();

        assert.isTrue(kernel.disposed, 'Kernel should be disposed');
        assert.isUndefined(kernelProvider.get(sampleUri1), 'Should not return an instance as kernel was disposed');
        const newKernel = kernelProvider.getOrCreate(instance(sampleNotebook1), options);
        asyncDisposables.push(newKernel);
        assert.notEqual(kernel, newKernel, 'Should return a different instance');
    });
    test('Dispose the kernel when the associated notebook document is closed', async () => {
        const metadata = mock<KernelConnectionMetadata>();
        when(metadata.id).thenReturn('xyz');
        const options: KernelOptions = {
            controller: instance(mock<NotebookController>()),
            metadata: instance(metadata),
            resourceUri: sampleUri1
        };

        const kernel = kernelProvider.getOrCreate(instance(sampleNotebook1), options);
        assert.isOk(kernel);
        const onKernelDisposed = createEventHandler(kernelProvider, 'onDidDisposeKernel', disposables);
        assert.isOk(kernelProvider.get(sampleUri1), 'Should return an instance');

        // Close the notebook.
        onDidCloseNotebookDocument.fire(instance(sampleNotebook1));
        assert.isTrue(kernel.disposed, 'Kernel should be disposed');
        await onKernelDisposed.assertFired(100);
        assert.isUndefined(kernelProvider.get(sampleUri1), 'Should not return an instance');

        // Calling getOrCreate again will return a whole new instance.
        const newKernel = kernelProvider.getOrCreate(instance(sampleNotebook1), options);
        asyncDisposables.push(newKernel);
        assert.notEqual(kernel, newKernel, 'Should return a different instance');
    });
});
