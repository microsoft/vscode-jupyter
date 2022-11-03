// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { instance, mock } from 'ts-mockito';
import { EventEmitter } from 'vscode';
import { IApplicationShell, IVSCodeNotebook } from '../platform/common/application/types';
import { IConfigurationService, IDisposable, IExtensionContext } from '../platform/common/types';
import { createEventHandler } from '../test/common';
import { createKernelController, TestNotebookDocument } from '../test/datascience/notebook/executionHelper';
import { IJupyterServerUriStorage } from './jupyter/types';
import { KernelProvider, ThirdPartyKernelProvider } from './kernelProvider.node';
import { Kernel, ThirdPartyKernel } from './kernel';
import { IKernelController, INotebookProvider, KernelConnectionMetadata } from './types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { noop } from '../test/core';

suite('Node Kernel Provider', function () {
    const disposables: IDisposable[] = [];
    const asyncDisposables: { dispose: () => Promise<unknown> }[] = [];
    let notebookProvider: INotebookProvider;
    let configService: IConfigurationService;
    let appShell: IApplicationShell;
    let vscNotebook: IVSCodeNotebook;
    let context: IExtensionContext;
    let jupyterServerUriStorage: IJupyterServerUriStorage;
    let metadata: KernelConnectionMetadata;
    let controller: IKernelController;
    setup(() => {
        notebookProvider = mock<INotebookProvider>();
        configService = mock<IConfigurationService>();
        appShell = mock<IApplicationShell>();
        vscNotebook = mock<IVSCodeNotebook>();
        context = mock<IExtensionContext>();
        jupyterServerUriStorage = mock<IJupyterServerUriStorage>();
        metadata = mock<KernelConnectionMetadata>();
        controller = createKernelController();
    });
    function createKernelProvider() {
        return new KernelProvider(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            asyncDisposables as any,
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
    }
    function create3rdPartyKernelProvider() {
        return new ThirdPartyKernelProvider(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            asyncDisposables as any,
            disposables,
            instance(notebookProvider),
            instance(configService),
            instance(appShell),
            instance(vscNotebook),
            []
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
