// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, NotebookDocument, NotebookEditor, NotebookRendererMessaging, Uri } from 'vscode';
import { Signal } from '@lumino/signaling';
import type { IKernelConnection } from '@jupyterlab/services/lib/kernel/kernel';
import type { IIOPubMessage, IOPubMessageType } from '@jupyterlab/services/lib/kernel/messages';
import type { KernelMessage } from '@jupyterlab/services';
import { IKernel, IKernelProvider, IKernelSession } from '../../../kernels/types';
import { IControllerRegistration, IVSCodeNotebookController } from '../../../notebooks/controllers/types';
import { IPyWidgetMessageDispatcherFactory } from '../../../notebooks/controllers/ipywidgets/message/ipyWidgetMessageDispatcherFactory';
import { IIPyWidgetMessageDispatcher } from '../../../notebooks/controllers/ipywidgets/types';
import { IPyWidgetRendererComms } from './rendererComms';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';
import { IDisposable } from '../../../platform/common/types';
import { dispose } from '../../../platform/common/utils/lifecycle';

suite('IPyWidgetRendererComms', () => {
    let rendererComms: IPyWidgetRendererComms;
    let kernelProvider: IKernelProvider;
    let controllers: IControllerRegistration;
    let dispatcherFactory: IPyWidgetMessageDispatcherFactory;
    let dispatcher: IIPyWidgetMessageDispatcher;
    let comms: NotebookRendererMessaging;
    let editor: NotebookEditor;
    let notebook: NotebookDocument;
    let kernel: IKernel;
    let session: IKernelSession;
    let kernelConnection: IKernelConnection;
    let iopubSignal: Signal<IKernelConnection, IIOPubMessage<IOPubMessageType>>;
    let onDidReceiveMessageEmitter: EventEmitter<{ editor: NotebookEditor; message: any }>;
    let onDidStartKernelEmitter: EventEmitter<IKernel>;
    let kernelOnStatusChangedEmitter: EventEmitter<KernelMessage.Status>;
    let kernelOnDisposedEmitter: EventEmitter<void>;
    let kernelOnStartedEmitter: EventEmitter<void>;
    let kernelOnRestartedEmitter: EventEmitter<void>;
    let disposables: IDisposable[] = [];

    setup(() => {
        disposables = [];
        kernelProvider = mock<IKernelProvider>();
        controllers = mock<IControllerRegistration>();
        dispatcherFactory = mock<IPyWidgetMessageDispatcherFactory>();
        dispatcher = mock<IIPyWidgetMessageDispatcher>();
        comms = mock<NotebookRendererMessaging>();
        editor = mock<NotebookEditor>();
        notebook = mock<NotebookDocument>();
        kernel = mock<IKernel>();
        session = mock<IKernelSession>();
        kernelConnection = mock<IKernelConnection>();

        iopubSignal = new Signal<IKernelConnection, IIOPubMessage<IOPubMessageType>>(instance(kernelConnection));
        onDidReceiveMessageEmitter = new EventEmitter<{ editor: NotebookEditor; message: any }>();
        onDidStartKernelEmitter = new EventEmitter<IKernel>();
        kernelOnStatusChangedEmitter = new EventEmitter<KernelMessage.Status>();
        kernelOnDisposedEmitter = new EventEmitter<void>();
        kernelOnStartedEmitter = new EventEmitter<void>();
        kernelOnRestartedEmitter = new EventEmitter<void>();

        when(editor.notebook).thenReturn(instance(notebook));
        when(kernel.notebook).thenReturn(instance(notebook));
        when(notebook.uri).thenReturn(Uri.file('test.ipynb'));
        when(kernel.onStatusChanged).thenReturn(kernelOnStatusChangedEmitter.event);
        when(kernel.onDisposed).thenReturn(kernelOnDisposedEmitter.event);
        when(kernel.onStarted).thenReturn(kernelOnStartedEmitter.event);
        when(kernel.onRestarted).thenReturn(kernelOnRestartedEmitter.event);
        when(kernel.session).thenReturn(instance(session));
        when(session.kernel).thenReturn(instance(kernelConnection));
        when(kernelConnection.iopubMessage).thenReturn(iopubSignal);

        when(dispatcher.onDisplayMessage).thenReturn(new EventEmitter<any>().event);
        when(dispatcherFactory.create(anything())).thenReturn(instance(dispatcher));

        when(kernelProvider.onDidStartKernel).thenReturn(onDidStartKernelEmitter.event);
        when(kernelProvider.get(instance(notebook))).thenReturn(instance(kernel));

        const controller = mock<IVSCodeNotebookController>();
        when(controllers.getSelected(instance(notebook))).thenReturn(instance(controller));

        when(comms.onDidReceiveMessage(anything(), anything(), anything())).thenCall((handler, thisArg, disp) => {
            return onDidReceiveMessageEmitter.event(handler, thisArg, disp);
        });
        when(comms.postMessage(anything(), anything())).thenResolve(true as any);

        when(mockedVSCodeNamespaces.notebooks.createRendererMessaging('jupyter-ipywidget-renderer')).thenReturn(
            instance(comms)
        );

        rendererComms = new IPyWidgetRendererComms(
            instance(kernelProvider),
            instance(controllers),
            instance(dispatcherFactory)
        );
        disposables.push(rendererComms);
    });

    teardown(() => {
        dispose(disposables);
    });

    test('model arrives while kernel is starting -> true', async () => {
        when(kernel.status).thenReturn('starting');
        rendererComms.activate();

        // Webview queries widget state for model 'widget-1' while kernel is starting
        onDidReceiveMessageEmitter.fire({
            editor: instance(editor),
            message: { command: 'query-widget-state', model_id: 'widget-1' }
        });

        // Query should NOT resolve immediately with false
        verify(comms.postMessage(anything(), anything())).never();

        // Kernel starts and IOPub comm_open message arrives for widget-1
        onDidStartKernelEmitter.fire(instance(kernel));
        iopubSignal.emit({
            header: { msg_id: '1', msg_type: 'comm_open' },
            content: { target_name: 'jupyter.widget', comm_id: 'widget-1' },
            channel: 'iopub'
        } as any);

        // Wait for microtask
        await Promise.resolve();

        // Should resolve with hasWidgetState = true
        verify(comms.postMessage(anything(), instance(editor))).once();
        const [sentMessage] = capture(comms.postMessage).last();
        assert.deepEqual(sentMessage, {
            command: 'query-widget-state',
            model_id: 'widget-1',
            hasWidgetState: true,
            kernelSelected: true
        });
    });

    test('kernel reaches idle without model -> false', async () => {
        when(kernel.status).thenReturn('starting');
        rendererComms.activate();

        // Webview queries widget state for model 'widget-2' while kernel is starting
        onDidReceiveMessageEmitter.fire({
            editor: instance(editor),
            message: { command: 'query-widget-state', model_id: 'widget-2' }
        });

        // Query should wait
        verify(comms.postMessage(anything(), anything())).never();

        // Kernel startup completes and transitions to idle without the model
        kernelOnStatusChangedEmitter.fire('idle');

        // Wait for microtask
        await Promise.resolve();

        // Should resolve with hasWidgetState = false
        verify(comms.postMessage(anything(), instance(editor))).once();
        const [sentMessage] = capture(comms.postMessage).last();
        assert.deepEqual(sentMessage, {
            command: 'query-widget-state',
            model_id: 'widget-2',
            hasWidgetState: false,
            kernelSelected: true
        });
    });

    test('model already known -> true immediately', async () => {
        when(kernel.status).thenReturn('idle');
        rendererComms.activate();

        // Kernel is started and already knows widget-3
        onDidStartKernelEmitter.fire(instance(kernel));
        iopubSignal.emit({
            header: { msg_id: '1', msg_type: 'comm_open' },
            content: { target_name: 'jupyter.widget', comm_id: 'widget-3' },
            channel: 'iopub'
        } as any);

        // Webview queries widget state
        onDidReceiveMessageEmitter.fire({
            editor: instance(editor),
            message: { command: 'query-widget-state', model_id: 'widget-3' }
        });

        // Immediately returns hasWidgetState = true
        verify(comms.postMessage(anything(), instance(editor))).once();
        const [sentMessage] = capture(comms.postMessage).last();
        assert.deepEqual(sentMessage, {
            command: 'query-widget-state',
            model_id: 'widget-3',
            hasWidgetState: true,
            kernelSelected: true
        });
    });

    test('kernel already idle without model -> false immediately', async () => {
        when(kernel.status).thenReturn('idle');
        rendererComms.activate();

        // Webview queries widget state for unknown model when kernel is already idle
        onDidReceiveMessageEmitter.fire({
            editor: instance(editor),
            message: { command: 'query-widget-state', model_id: 'unknown-widget' }
        });

        // Immediately returns hasWidgetState = false
        verify(comms.postMessage(anything(), instance(editor))).once();
        const [sentMessage] = capture(comms.postMessage).last();
        assert.deepEqual(sentMessage, {
            command: 'query-widget-state',
            model_id: 'unknown-widget',
            hasWidgetState: false,
            kernelSelected: true
        });
    });
});
