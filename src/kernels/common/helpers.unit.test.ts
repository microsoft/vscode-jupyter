// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ISignal, Signal } from '@lumino/signaling';
import * as sinon from 'sinon';
import { assert } from 'chai';
import { IChangedArgs } from '@jupyterlab/coreutils';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { mock, when, instance } from 'ts-mockito';
import { CancellationError, CancellationTokenSource, Disposable, Uri } from 'vscode';
import { INewSessionWithSocket, LocalKernelSpecConnectionMetadata } from '../types';
import { noop } from '../../test/core';
import { IDisposable } from '../../platform/common/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { waitForIdleOnSession } from './helpers';
import { JupyterWaitForIdleError } from '../errors/jupyterWaitForIdleError';
import { JupyterInvalidKernelError } from '../errors/jupyterInvalidKernelError';

suite.only('Kernel Common Helpers', () => {
    const kernelConnectionMetadata = LocalKernelSpecConnectionMetadata.create({
        id: '1234',
        kernelSpec: {} as any
    });
    let session: INewSessionWithSocket;
    let token: CancellationTokenSource;
    const disposables: IDisposable[] = [];
    let kernel: Kernel.IKernelConnection;
    let sessionDisposed: Signal<INewSessionWithSocket, void>;

    setup(() => {
        token = new CancellationTokenSource();
        disposables.push(token);

        session = mock<INewSessionWithSocket>();
        kernel = mock<Kernel.IKernelConnection>();
        when(session.shutdown()).thenResolve();
        when(session.dispose()).thenReturn();
        when(session.kernel).thenReturn(instance(kernel));
        sessionDisposed = new Signal<INewSessionWithSocket, void>(instance(session));
        const sessionPropertyChanged = new Signal<INewSessionWithSocket, 'path'>(instance(session));
        const sessionIOPubMessage = new Signal<INewSessionWithSocket, KernelMessage.IIOPubMessage>(instance(session));
        const sessionKernelChanged = new Signal<
            INewSessionWithSocket,
            IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
        >(instance(session));
        const sessionUnhandledMessage = new Signal<INewSessionWithSocket, KernelMessage.IMessage>(instance(session));
        const sessionConnectionStatusChanged = new Signal<INewSessionWithSocket, Kernel.ConnectionStatus>(
            instance(session)
        );
        const sessionAnyMessage = new Signal<INewSessionWithSocket, Kernel.IAnyMessageArgs>(instance(session));
        when(session.disposed).thenReturn(sessionDisposed);
        when(session.propertyChanged).thenReturn(sessionPropertyChanged);
        when(session.iopubMessage).thenReturn(sessionIOPubMessage);
        when(session.kernelChanged).thenReturn(sessionKernelChanged);
        when(session.statusChanged).thenReturn(new Signal<INewSessionWithSocket, Kernel.Status>(instance(session)));
        when(session.unhandledMessage).thenReturn(sessionUnhandledMessage);
        when(session.connectionStatusChanged).thenReturn(sessionConnectionStatusChanged);
        when(session.anyMessage).thenReturn(sessionAnyMessage);
        when(session.isDisposed).thenReturn(false);
        when(kernel.status).thenReturn('idle');
        when(kernel.connectionStatus).thenReturn('connected');
        when(kernel.statusChanged).thenReturn(new Signal<Kernel.IKernelConnection, Kernel.Status>(instance(kernel)));
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
    });
    teardown(() => disposeAllDisposables(disposables));
    test('Wait for Idle (kernel is already idle', async () => {
        when(kernel.status).thenReturn('idle');

        await waitForIdleOnSession(
            kernelConnectionMetadata,
            Uri.file('one.ipynb'),
            instance(session),
            1_000,
            token.token
        );
    });
    test('Wait for Idle (wait for status to change within the timeout period)', async () => {
        when(kernel.status).thenReturn('busy');
        const clock = sinon.useFakeTimers();
        disposables.push({ dispose: () => clock.restore() });

        const promise = waitForIdleOnSession(
            kernelConnectionMetadata,
            Uri.file('one.ipynb'),
            instance(session),
            10_000,
            token.token
        );
        setTimeout(() => {
            when(kernel.status).thenReturn('idle');
            (instance(kernel).statusChanged as Signal<Kernel.IKernelConnection, Kernel.Status>).emit('idle');
        }, 3_000);

        clock.tick(4_000);
        await clock.runAllAsync();

        await promise;
    });
    test('Timeout waiting for idle', async () => {
        when(kernel.status).thenReturn('busy');
        const clock = sinon.useFakeTimers();
        disposables.push({ dispose: () => clock.restore() });

        const promise = waitForIdleOnSession(
            kernelConnectionMetadata,
            Uri.file('one.ipynb'),
            instance(session),
            10_000,
            token.token
        );

        clock.tick(11_000);
        await clock.runAllAsync();

        await assert.isRejected(promise, new JupyterWaitForIdleError(kernelConnectionMetadata).message);
    });
    test('Cancel waiting for idle', async () => {
        when(kernel.status).thenReturn('busy');
        const clock = sinon.useFakeTimers();
        disposables.push({ dispose: () => clock.restore() });

        const promise = waitForIdleOnSession(
            kernelConnectionMetadata,
            Uri.file('one.ipynb'),
            instance(session),
            10_000,
            token.token
        );
        setTimeout(() => token.cancel(), 3_000);
        clock.tick(3_000);
        await clock.runAllAsync();

        await assert.isRejected(promise, new CancellationError().message);
    });
    test('Session dies while waiting for idle', async () => {
        when(kernel.status).thenReturn('busy');
        const clock = sinon.useFakeTimers();
        disposables.push({ dispose: () => clock.restore() });

        const promise = waitForIdleOnSession(
            kernelConnectionMetadata,
            Uri.file('one.ipynb'),
            instance(session),
            10_000,
            token.token
        );
        setTimeout(() => {
            when(session.isDisposed).thenReturn(true);
            sessionDisposed.emit();
        }, 3_000);
        clock.tick(3_000);
        await clock.runAllAsync();

        await assert.isRejected(promise, new JupyterInvalidKernelError(kernelConnectionMetadata).message);
    });
    test('Waiting for idle fails without a Kernel', async () => {
        when(session.kernel).thenReturn(null);

        const promise = waitForIdleOnSession(
            kernelConnectionMetadata,
            Uri.file('one.ipynb'),
            instance(session),
            10_000,
            token.token
        );

        await assert.isRejected(promise, new JupyterInvalidKernelError(kernelConnectionMetadata).message);
    });
});
