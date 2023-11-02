// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { ISignal, Signal } from '@lumino/signaling';
import { IChangedArgs } from '@jupyterlab/coreutils';
import { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import { mock, when, instance, verify } from 'ts-mockito';
import { CancellationToken, CancellationTokenSource } from 'vscode';
import { IDisposable } from '../../platform/common/types';
import { noop } from '../../test/core';
import { BaseJupyterSessionConnection } from './baseJupyterSessionConnection';
import { dispose } from '../../platform/common/utils/lifecycle';
import { createEventHandler } from '../../test/common';

suite('Base Jupyter Session Connection', () => {
    let disposables: IDisposable[] = [];
    let jupyterSession: BaseJupyterSessionConnection<Session.ISessionConnection, 'remoteJupyter'>;
    let session: Session.ISessionConnection;
    let kernel: Kernel.IKernelConnection;
    let token: CancellationTokenSource;
    let sessionDisposed: Signal<Session.ISessionConnection, void>;
    let sessionPropertyChanged: Signal<Session.ISessionConnection, 'path'>;
    let sessionIOPubMessage: Signal<Session.ISessionConnection, KernelMessage.IIOPubMessage>;
    let sessionKernelChanged: Signal<
        Session.ISessionConnection,
        IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
    >;
    let sessionUnhandledMessage: Signal<Session.ISessionConnection, KernelMessage.IMessage>;
    let sessionConnectionStatusChanged: Signal<Session.ISessionConnection, Kernel.ConnectionStatus>;
    let sessionAnyMessage: Signal<Session.ISessionConnection, Kernel.IAnyMessageArgs>;
    class DummySessionClass extends BaseJupyterSessionConnection<Session.ISessionConnection, 'remoteJupyter'> {
        override waitForIdle(_timeout: number, _token: CancellationToken): Promise<void> {
            throw new Error('Method not implemented.');
        }
        public override status: Kernel.Status;
        constructor(session: Session.ISessionConnection) {
            super('remoteJupyter', session);
            this.initializeKernelSocket();
        }
        override shutdown(): Promise<void> {
            throw new Error('Method not implemented.');
        }
    }

    function createKernel() {
        const kernel = mock<Kernel.IKernelConnection>();
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

        return kernel;
    }
    setup(() => {
        token = new CancellationTokenSource();
        disposables.push(token);

        session = mock<Session.ISessionConnection>();
        kernel = createKernel();
        when(session.shutdown()).thenResolve();
        when(session.dispose()).thenReturn();
        when(session.kernel).thenReturn(instance(kernel));
        sessionDisposed = new Signal<Session.ISessionConnection, void>(instance(session));
        sessionPropertyChanged = new Signal<Session.ISessionConnection, 'path'>(instance(session));
        sessionIOPubMessage = new Signal<Session.ISessionConnection, KernelMessage.IIOPubMessage>(instance(session));
        sessionKernelChanged = new Signal<
            Session.ISessionConnection,
            IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
        >(instance(session));
        sessionUnhandledMessage = new Signal<Session.ISessionConnection, KernelMessage.IMessage>(instance(session));
        sessionConnectionStatusChanged = new Signal<Session.ISessionConnection, Kernel.ConnectionStatus>(
            instance(session)
        );
        sessionAnyMessage = new Signal<Session.ISessionConnection, Kernel.IAnyMessageArgs>(instance(session));
        when(session.disposed).thenReturn(sessionDisposed);
        when(session.propertyChanged).thenReturn(sessionPropertyChanged);
        when(session.iopubMessage).thenReturn(sessionIOPubMessage);
        when(session.kernelChanged).thenReturn(sessionKernelChanged);
        when(session.statusChanged).thenReturn(
            new Signal<Session.ISessionConnection, Kernel.Status>(instance(session))
        );
        when(session.unhandledMessage).thenReturn(sessionUnhandledMessage);
        when(session.connectionStatusChanged).thenReturn(sessionConnectionStatusChanged);
        when(session.anyMessage).thenReturn(sessionAnyMessage);
        when(session.isDisposed).thenReturn(false);
        jupyterSession = new DummySessionClass(instance(session));
    });

    teardown(() => (disposables = dispose(disposables)));
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
        const statuses: Kernel.Status[] = [];
        let disposedEmitted = false;
        jupyterSession.statusChanged.connect((_, args) => statuses.push(args));
        jupyterSession.disposed.connect(() => (disposedEmitted = true));
        const disposed = createEventHandler(jupyterSession, 'onDidDispose', disposables);

        jupyterSession.dispose();

        assert.deepEqual(statuses, ['dead']);
        assert.strictEqual(disposedEmitted, true);
        assert.strictEqual(disposed.count, 1);
    });
    test('Restarting will restart the underlying kernel', async () => {
        when(kernel.restart()).thenResolve();

        await jupyterSession.restart();

        verify(kernel.restart()).once();
    });
});
