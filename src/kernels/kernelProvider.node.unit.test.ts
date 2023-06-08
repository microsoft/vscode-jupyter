// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import {
    EventEmitter,
    Memento,
    NotebookCellExecutionStateChangeEvent,
    NotebookController,
    NotebookDocument,
    Uri
} from 'vscode';
import { IApplicationShell, IVSCodeNotebook } from '../platform/common/application/types';
import {
    IConfigurationService,
    IDisposable,
    IExtensionContext,
    IWatchableJupyterSettings
} from '../platform/common/types';
import { createEventHandler } from '../test/common';
import { createKernelController, TestNotebookDocument } from '../test/datascience/notebook/executionHelper';
import { IJupyterServerUriStorage } from './jupyter/types';
import { KernelProvider, ThirdPartyKernelProvider } from './kernelProvider.node';
import { Kernel, ThirdPartyKernel } from './kernel';
import {
    IKernelSessionFactory,
    IKernelController,
    IKernelProvider,
    IStartupCodeProviders,
    IThirdPartyKernelProvider,
    KernelConnectionMetadata,
    KernelOptions
} from './types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { noop } from '../test/core';
import { AsyncDisposableRegistry } from '../platform/common/asyncDisposableRegistry';
import { JupyterNotebookView } from '../platform/common/constants';
import { mockedVSCodeNamespaces } from '../test/vscode-mock';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';

suite('Node Kernel Provider', function () {
    const disposables: IDisposable[] = [];
    const asyncDisposables: { dispose: () => Promise<unknown> }[] = [];
    let sessionCreator: IKernelSessionFactory;
    let configService: IConfigurationService;
    let appShell: IApplicationShell;
    let vscNotebook: IVSCodeNotebook;
    let context: IExtensionContext;
    let jupyterServerUriStorage: IJupyterServerUriStorage;
    let metadata: KernelConnectionMetadata;
    let controller: IKernelController;
    let workspaceMemento: Memento;
    setup(() => {
        sessionCreator = mock<IKernelSessionFactory>();
        configService = mock<IConfigurationService>();
        appShell = mock<IApplicationShell>();
        vscNotebook = mock<IVSCodeNotebook>();
        context = mock<IExtensionContext>();
        jupyterServerUriStorage = mock<IJupyterServerUriStorage>();
        metadata = mock<KernelConnectionMetadata>();
        controller = createKernelController();
        workspaceMemento = mock<Memento>();
        when(workspaceMemento.update(anything(), anything())).thenResolve();
        when(workspaceMemento.get(anything(), anything())).thenCall(
            (_: unknown, defaultValue: unknown) => defaultValue
        );
    });
    function createKernelProvider() {
        const registry = mock<IStartupCodeProviders>();
        when(registry.getProviders(anything())).thenReturn([]);
        return new KernelProvider(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            asyncDisposables as any,
            disposables,
            instance(sessionCreator),
            instance(configService),
            instance(appShell),
            instance(vscNotebook),
            instance(context),
            instance(jupyterServerUriStorage),
            [],
            instance(registry),
            instance(workspaceMemento)
        );
    }
    function create3rdPartyKernelProvider() {
        const registry = mock<IStartupCodeProviders>();
        when(registry.getProviders(anything())).thenReturn([]);
        return new ThirdPartyKernelProvider(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            asyncDisposables as any,
            disposables,
            instance(sessionCreator),
            instance(configService),
            instance(appShell),
            instance(vscNotebook),
            instance(registry),
            instance(workspaceMemento)
        );
    }
    teardown(async () => {
        sinon.restore();
        disposeAllDisposables(disposables);
        await Promise.all(asyncDisposables.map((item) => item.dispose().catch(noop)));
        asyncDisposables.length = 0;
    });
    function testKernelProviderEvents(thirdPartyKernelProvider = false) {
        const kernelProvider = thirdPartyKernelProvider ? create3rdPartyKernelProvider() : createKernelProvider();
        const kernelCreated = createEventHandler(kernelProvider, 'onDidCreateKernel', disposables);
        const kernelStarted = createEventHandler(kernelProvider, 'onDidStartKernel', disposables);
        const kernelDisposed = createEventHandler(kernelProvider, 'onDidDisposeKernel', disposables);
        const kernelRestarted = createEventHandler(kernelProvider, 'onDidRestartKernel', disposables);
        const kernelStatusChanged = createEventHandler(kernelProvider, 'onKernelStatusChanged', disposables);
        const notebook = new TestNotebookDocument(undefined, 'jupyter-notebook');
        const onStarted = new EventEmitter<void>();
        const onStatusChanged = new EventEmitter<void>();
        const onRestartedEvent = new EventEmitter<void>();
        const onDisposedEvent = new EventEmitter<void>();
        disposables.push(onStatusChanged);
        disposables.push(onRestartedEvent);
        disposables.push(onStarted);
        disposables.push(onDisposedEvent);
        if (kernelProvider instanceof KernelProvider) {
            sinon.stub(Kernel.prototype, 'onStarted').get(() => onStarted.event);
            sinon.stub(Kernel.prototype, 'onStatusChanged').get(() => onStatusChanged.event);
            sinon.stub(Kernel.prototype, 'onRestarted').get(() => onRestartedEvent.event);
            sinon.stub(Kernel.prototype, 'onDisposed').get(() => onDisposedEvent.event);
            const kernel = kernelProvider.getOrCreate(notebook, {
                controller,
                metadata: instance(metadata),
                resourceUri: notebook.uri
            });
            asyncDisposables.push(kernel);
        } else {
            sinon.stub(ThirdPartyKernel.prototype, 'onStarted').get(() => onStarted.event);
            sinon.stub(ThirdPartyKernel.prototype, 'onStatusChanged').get(() => onStatusChanged.event);
            sinon.stub(ThirdPartyKernel.prototype, 'onRestarted').get(() => onRestartedEvent.event);
            sinon.stub(ThirdPartyKernel.prototype, 'onDisposed').get(() => onDisposedEvent.event);
            const kernel = kernelProvider.getOrCreate(notebook.uri, {
                metadata: instance(metadata),
                resourceUri: notebook.uri
            });
            asyncDisposables.push(kernel);
        }

        assert.isTrue(kernelCreated.fired, 'IKernelProvider.onDidCreateKernel not fired');
        assert.isFalse(kernelStarted.fired, 'IKernelProvider.onDidStartKernel should not be fired');
        assert.isFalse(kernelStatusChanged.fired, 'IKernelProvider.onKernelStatusChanged should not be fired');
        assert.isFalse(kernelRestarted.fired, 'IKernelProvider.onDidRestartKernel should not have fired');
        assert.isFalse(kernelDisposed.fired, 'IKernelProvider.onDidDisposeKernel should not have fired');

        onStarted.fire();
        assert.isTrue(kernelStarted.fired, 'IKernelProvider.onDidStartKernel not fired');
        onStatusChanged.fire();
        assert.isTrue(kernelStatusChanged.fired, 'IKernelProvider.onKernelStatusChanged not fired');
        onRestartedEvent.fire();
        assert.isTrue(kernelRestarted.fired, 'IKernelProvider.onKernelRestarted not fired');
        onDisposedEvent.fire();
        assert.isTrue(kernelDisposed.fired, 'IKernelProvider.onDisposedEvent not fired');
    }
    test('Kernel Events', () => testKernelProviderEvents(false));
    test('3rd Party Kernel Events', () => testKernelProviderEvents(true));
});

suite('KernelProvider Node', () => {
    const disposables: IDisposable[] = [];
    let asyncDisposables: AsyncDisposableRegistry;
    let kernelProvider: IKernelProvider;
    let thirdPartyKernelProvider: IThirdPartyKernelProvider;
    let sessionCreator: IKernelSessionFactory;
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
        sessionCreator = mock<IKernelSessionFactory>();
        configService = mock<IConfigurationService>();
        appShell = mock<IApplicationShell>();
        vscNotebook = mock<IVSCodeNotebook>();
        jupyterServerUriStorage = mock<IJupyterServerUriStorage>();
        context = mock<IExtensionContext>();
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
        const registry = mock<IStartupCodeProviders>();
        when(registry.getProviders(anything())).thenReturn([]);
        const workspaceMemento = mock<Memento>();
        when(workspaceMemento.update(anything(), anything())).thenResolve();
        when(workspaceMemento.get(anything(), anything())).thenCall(
            (_: unknown, defaultValue: unknown) => defaultValue
        );

        kernelProvider = new KernelProvider(
            asyncDisposables,
            disposables,
            instance(sessionCreator),
            instance(configService),
            instance(appShell),
            instance(vscNotebook),
            instance(context),
            instance(jupyterServerUriStorage),
            [],
            instance(registry),
            instance(workspaceMemento)
        );
        thirdPartyKernelProvider = new ThirdPartyKernelProvider(
            asyncDisposables,
            disposables,
            instance(sessionCreator),
            instance(configService),
            instance(appShell),
            instance(vscNotebook),
            instance(registry),
            instance(workspaceMemento)
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
