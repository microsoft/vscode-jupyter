// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ISignal, Signal } from '@lumino/signaling';
import { IChangedArgs } from '@jupyterlab/coreutils';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { mock, when, instance, verify } from 'ts-mockito';
import { Disposable, Uri } from 'vscode';
import { RawJupyterSessionWrapper } from './rawJupyterSession.node';
import { RawSessionConnection } from './rawSession.node';
import { LocalKernelSpecConnectionMetadata } from '../../types';
import { noop } from '../../../test/core';
import { assert } from 'chai';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';

suite('Raw Jupyter Session Wrapper', () => {
    let sessionWrapper: RawJupyterSessionWrapper;
    let session: RawSessionConnection;
    const kernelConnectionMetadata = LocalKernelSpecConnectionMetadata.create({
        id: '1234',
        kernelSpec: {} as any
    });
    const disposables: IDisposable[] = [];
    setup(() => {
        session = mock<RawSessionConnection>();
        const kernel = mock<Kernel.IKernelConnection>();
        when(session.shutdown()).thenResolve();
        when(session.dispose()).thenReturn();
        when(session.kernel).thenReturn(instance(kernel));
        const sessionDisposed = new Signal<RawSessionConnection, void>(instance(session));
        const sessionPropertyChanged = new Signal<RawSessionConnection, 'path'>(instance(session));
        const sessionIOPubMessage = new Signal<RawSessionConnection, KernelMessage.IIOPubMessage>(instance(session));
        const sessionKernelChanged = new Signal<
            RawSessionConnection,
            IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
        >(instance(session));
        const sessionUnhandledMessage = new Signal<RawSessionConnection, KernelMessage.IMessage>(instance(session));
        const sessionConnectionStatusChanged = new Signal<RawSessionConnection, Kernel.ConnectionStatus>(
            instance(session)
        );
        const sessionAnyMessage = new Signal<RawSessionConnection, Kernel.IAnyMessageArgs>(instance(session));
        when(session.disposed).thenReturn(sessionDisposed);
        when(session.propertyChanged).thenReturn(sessionPropertyChanged);
        when(session.iopubMessage).thenReturn(sessionIOPubMessage);
        when(session.kernelChanged).thenReturn(sessionKernelChanged);
        when(session.statusChanged).thenReturn(new Signal<RawSessionConnection, Kernel.Status>(instance(session)));
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
        disposables.push(new Disposable(() => Signal.disconnectAll(instance(session))));
        disposables.push(new Disposable(() => Signal.disconnectAll(instance(kernel))));
        sessionWrapper = new RawJupyterSessionWrapper(
            instance(session),
            Uri.file('one.ipynb'),
            kernelConnectionMetadata
        );
    });
    teardown(() => disposeAllDisposables(disposables));
    test('Shutdown', async () => {
        when(session.dispose()).thenReturn();
        const statuses: (typeof sessionWrapper.status)[] = [];
        sessionWrapper.statusChanged.connect((_, s) => statuses.push(s));

        await sessionWrapper.shutdown();

        verify(session.shutdown()).once();
        verify(session.dispose()).never();
        assert.strictEqual(sessionWrapper.status, 'dead');
        assert.deepEqual(statuses, ['terminating', 'dead']);
    });
    test('Dispose', async () => {
        when(session.dispose()).thenReturn();
        const statuses: (typeof sessionWrapper.status)[] = [];
        sessionWrapper.statusChanged.connect((_, s) => statuses.push(s));

        await sessionWrapper.disposeAsync();

        verify(session.shutdown()).once();
        verify(session.dispose()).once();
        assert.strictEqual(sessionWrapper.status, 'dead');
        assert.deepEqual(statuses, ['terminating', 'dead']);
    });
});
