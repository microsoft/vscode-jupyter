// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { ISignal, Signal } from '@lumino/signaling';
import { IChangedArgs } from '@jupyterlab/coreutils';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { mock, when, instance, verify } from 'ts-mockito';
import { CancellationTokenSource } from 'vscode';
import { IDisposable } from '../../platform/common/types';
import { IKernelSocket, INewSessionWithSocket, KernelSocketInformation } from '../types';
import { noop } from '../../test/core';
import { BaseJupyterSessionConnection } from './baseJupyterSessionConnection';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { createEventHandler } from '../../test/common';

suite('Base Jupyter Session Connection', () => {
    const disposables: IDisposable[] = [];
    let jupyterSession: BaseJupyterSessionConnection<INewSessionWithSocket>;
    let session: INewSessionWithSocket;
    let kernel: Kernel.IKernelConnection;
    let token: CancellationTokenSource;
    let sessionDisposed: Signal<INewSessionWithSocket, void>;
    let kernelSocketInformation: KernelSocketInformation;
    let sessionPropertyChanged: Signal<INewSessionWithSocket, 'path'>;
    let sessionIOPubMessage: Signal<INewSessionWithSocket, KernelMessage.IIOPubMessage>;
    let sessionKernelChanged: Signal<
        INewSessionWithSocket,
        IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
    >;
    let sessionUnhandledMessage: Signal<INewSessionWithSocket, KernelMessage.IMessage>;
    let sessionConnectionStatusChanged: Signal<INewSessionWithSocket, Kernel.ConnectionStatus>;
    let sessionAnyMessage: Signal<INewSessionWithSocket, Kernel.IAnyMessageArgs>;
    class DummySessionClass extends BaseJupyterSessionConnection<INewSessionWithSocket> {
        public override status: Kernel.Status;
        constructor(session: INewSessionWithSocket) {
            super(session);
            this.initializeKernelSocket();
        }
        override shutdown(): Promise<void> {
            throw new Error('Method not implemented.');
        }
    }

    setup(() => {
        token = new CancellationTokenSource();
        disposables.push(token);

        session = mock<INewSessionWithSocket>();
        kernel = mock<Kernel.IKernelConnection>();
        when(session.shutdown()).thenResolve();
        when(session.dispose()).thenReturn();
        when(session.kernel).thenReturn(instance(kernel));
        sessionDisposed = new Signal<INewSessionWithSocket, void>(instance(session));
        sessionPropertyChanged = new Signal<INewSessionWithSocket, 'path'>(instance(session));
        sessionIOPubMessage = new Signal<INewSessionWithSocket, KernelMessage.IIOPubMessage>(instance(session));
        sessionKernelChanged = new Signal<
            INewSessionWithSocket,
            IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
        >(instance(session));
        sessionUnhandledMessage = new Signal<INewSessionWithSocket, KernelMessage.IMessage>(instance(session));
        sessionConnectionStatusChanged = new Signal<INewSessionWithSocket, Kernel.ConnectionStatus>(instance(session));
        sessionAnyMessage = new Signal<INewSessionWithSocket, Kernel.IAnyMessageArgs>(instance(session));
        kernelSocketInformation = mock<KernelSocketInformation>();
        when(kernelSocketInformation.socket).thenReturn(instance(mock<IKernelSocket>()));
        when(session.disposed).thenReturn(sessionDisposed);
        when(session.propertyChanged).thenReturn(sessionPropertyChanged);
        when(session.kernelSocketInformation).thenReturn(instance(kernelSocketInformation));
        when(session.iopubMessage).thenReturn(sessionIOPubMessage);
        when(session.kernelChanged).thenReturn(sessionKernelChanged);
        when(session.statusChanged).thenReturn(new Signal<INewSessionWithSocket, Kernel.Status>(instance(session)));
        when(session.unhandledMessage).thenReturn(sessionUnhandledMessage);
        when(session.connectionStatusChanged).thenReturn(sessionConnectionStatusChanged);
        when(session.anyMessage).thenReturn(sessionAnyMessage);
        when(session.isDisposed).thenReturn(false);
        when(kernel.status).thenReturn('idle');
        when(kernel.connectionStatus).thenReturn('connected');
        when(kernel.statusChanged).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, Kernel.Status>>()));
        when(kernel.iopubMessage).thenReturn(
            instance(
                mock<ISignal<Kernel.IKernelConnection, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>>()
            )
        );
        when(kernel.anyMessage).thenReturn({ connect: noop, disconnect: noop } as any);
        when(kernel.unhandledMessage).thenReturn(
            instance(mock<ISignal<Kernel.IKernelConnection, KernelMessage.IMessage<KernelMessage.MessageType>>>())
        );
        when(kernel.disposed).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, void>>()));
        when(kernel.connectionStatusChanged).thenReturn(
            instance(mock<ISignal<Kernel.IKernelConnection, Kernel.ConnectionStatus>>())
        );
        when(kernel.clientId).thenReturn('some Client Id');
        when(kernel.id).thenReturn('some Kernel Id');
        when(kernel.username).thenReturn('some User Name');
        when(kernel.model).thenReturn({ id: 'some Model Id', name: 'some Model Name' });
        jupyterSession = new DummySessionClass(instance(session));
    });

    teardown(() => disposeAllDisposables(disposables));
    test('Events are propagated', () => {
        const eventNames: (keyof typeof jupyterSession)[] = [
            'anyMessage',
            'connectionStatusChanged',
            'disposed',
            'iopubMessage',
            'kernelChanged',
            'statusChanged',
            'propertyChanged',
            'statusChanged',
            'unhandledMessage'
        ];
        const event: { sender: unknown; args: unknown } = { sender: undefined, args: undefined };

        eventNames.forEach((eventName) => {
            event.sender = undefined;
            event.args = undefined;
            const signal = jupyterSession[eventName] as Signal<any, any>;
            signal.connect((sender: unknown, args: unknown) => {
                event.sender = sender;
                event.args = args;
            });

            const bogusData = { bogus: 'Some Bogus Event Data' };
            signal.emit(bogusData);

            assert.strictEqual(event.sender, jupyterSession);
            assert.strictEqual(event.args, bogusData);
        });
    });
    test('Methods are invoked in real session', () => {
        const methodNames: (keyof typeof jupyterSession)[] = ['changeKernel', 'setName', 'setPath', 'setType'];

        methodNames.forEach((methodName) => {
            const bogusData = { bogus: 'Some Bogus Event Data' };
            (jupyterSession[methodName] as Function)(bogusData);

            verify(((session as any)[methodName] as any)(bogusData)).once();
        });
    });
    test('Disposing session triggers the right events', () => {
        let status = '';
        let disposedEmitted = false;
        jupyterSession.statusChanged.connect((_, args) => (status = args));
        jupyterSession.disposed.connect(() => (disposedEmitted = true));
        const disposed = createEventHandler(jupyterSession, 'onDidDispose', disposables);
        const statusChanged = createEventHandler(jupyterSession, 'onSessionStatusChanged', disposables);

        jupyterSession.dispose();

        assert.strictEqual(status, 'dead');
        assert.strictEqual(disposedEmitted, true);
        assert.strictEqual(disposed.count, 1);
        assert.strictEqual(statusChanged.count, 1);
    });
    test('Restarting will restart the underlying kernel', async () => {
        when(kernel.restart()).thenResolve();

        await jupyterSession.restart();

        verify(kernel.restart()).once();
    });
    test('Kernel Socket information available on start', async () => {
        let socketInfo: KernelSocketInformation | undefined;

        jupyterSession.kernelSocket.subscribe((info) => (socketInfo = info));

        assert.strictEqual(socketInfo?.socket, instance(kernelSocketInformation).socket);
        assert.strictEqual(socketInfo?.options.clientId, 'some Client Id');
        assert.strictEqual(socketInfo?.options.id, 'some Kernel Id');
        assert.strictEqual(socketInfo?.options.userName, 'some User Name');
        assert.strictEqual(socketInfo?.options.model.id, 'some Model Id');
        assert.strictEqual(socketInfo?.options.model.name, 'some Model Name');
    });
    test('Kernel Socket information changes after restarting kernel', async () => {
        const newKernelSocketInformation = mock<KernelSocketInformation>();
        const newSocket = mock<IKernelSocket>();
        when(newKernelSocketInformation.socket).thenReturn(instance(newSocket));

        when(session.kernelSocketInformation).thenReturn(instance(newKernelSocketInformation));

        let socketInfo: KernelSocketInformation | undefined;
        jupyterSession.kernelSocket.subscribe((info) => (socketInfo = info));
        await jupyterSession.restart();

        assert.strictEqual(socketInfo?.socket, instance(newSocket));
        assert.strictEqual(socketInfo?.options.clientId, 'some Client Id');
        assert.strictEqual(socketInfo?.options.id, 'some Kernel Id');
        assert.strictEqual(socketInfo?.options.userName, 'some User Name');
        assert.strictEqual(socketInfo?.options.model.id, 'some Model Id');
        assert.strictEqual(socketInfo?.options.model.name, 'some Model Name');
    });
});
