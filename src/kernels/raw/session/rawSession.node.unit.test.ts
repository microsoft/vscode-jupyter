// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ISignal, Signal } from '@lumino/signaling';
import * as sinon from 'sinon';
import { Kernel, KernelMessage, ServerConnection } from '@jupyterlab/services';
import { mock, when, instance, verify, anything } from 'ts-mockito';
import { CancellationTokenSource, EventEmitter, Uri } from 'vscode';
import { RawSessionConnection } from './rawSession.node';
import { LocalKernelSpecConnectionMetadata } from '../../types';
import { noop } from '../../../test/core';
import { assert } from 'chai';
import { IKernelLauncher, IKernelProcess } from '../types';
import { IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { waitForCondition } from '../../../test/common';
const nonSerializingKernel =
    require('@jupyterlab/services/lib/kernel/nonSerializingKernel') as typeof import('@jupyterlab/services/lib/kernel/default');
suite('Raw Session & Raw Kernel Connection', () => {
    let session: RawSessionConnection;
    let kernelLauncher: IKernelLauncher;
    let token: CancellationTokenSource;
    let kernelProcess: IKernelProcess;
    let kernel: Kernel.IKernelConnection;
    let exitedEvent: EventEmitter<{
        exitCode?: number | undefined;
        reason?: string | undefined;
    }>;
    const disposables: IDisposable[] = [];
    const kernelConnectionMetadata = LocalKernelSpecConnectionMetadata.create({
        id: '1234',
        kernelSpec: {
            argv: ['r'],
            display_name: 'Hello',
            executable: 'r',
            name: 'R'
        }
    });
    const OldKernelConnectionClass = nonSerializingKernel.KernelConnection;
    const kernelInfo: KernelMessage.IInfoReply = {
        banner: '',
        help_links: [],
        implementation: '',
        implementation_version: '',
        language_info: { name: '', version: '' },
        protocol_version: '',
        status: 'ok'
    };
    const kernelInfoResponse: KernelMessage.IInfoReplyMsg = {
        channel: 'shell',
        header: {
            date: '',
            msg_id: '1',
            msg_type: 'kernel_info_reply',
            session: '',
            username: '',
            version: ''
        },
        content: kernelInfo,
        metadata: {},
        parent_header: {
            date: '',
            msg_id: '1',
            msg_type: 'kernel_info_request',
            session: '',
            username: '',
            version: ''
        }
    };
    const someIOPubMessage: KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType> = {
        header: {
            date: '',
            msg_id: '1',
            msg_type: 'status',
            session: '',
            username: '',
            version: ''
        },
        channel: 'iopub',
        content: {
            status: 'ok'
        },
        metadata: {},
        parent_header: {
            date: '',
            msg_id: '1',
            msg_type: 'kernel_info_request',
            session: '',
            username: '',
            version: ''
        }
    };
    function createKernelProcess() {
        const kernelProcess = mock<IKernelProcess>();
        when(kernelProcess.canInterrupt).thenReturn(true);
        when(kernelProcess.connection).thenReturn({
            control_port: 1,
            hb_port: 2,
            iopub_port: 3,
            ip: '123',
            key: '',
            shell_port: 4,
            signature_scheme: 'hmac-sha256',
            stdin_port: 5,
            transport: 'tcp'
        });
        when(kernelProcess.dispose()).thenResolve();
        when(kernelProcess.exited).thenReturn(exitedEvent.event);
        when(kernelProcess.interrupt).thenResolve();
        when(kernelProcess.kernelConnectionMetadata).thenReturn(kernelConnectionMetadata);
        when(kernelProcess.pid).thenReturn(9999);
        return kernelProcess;
    }
    function createKernel() {
        const kernel = mock<Kernel.IKernelConnection>();
        const iopubMessage = new Signal<
            Kernel.IKernelConnection,
            KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>
        >(instance(kernel));
        when(kernel.status).thenReturn('idle');
        when(kernel.connectionStatus).thenReturn('connected');
        when(kernel.statusChanged).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, Kernel.Status>>()));
        when(kernel.iopubMessage).thenReturn(iopubMessage);
        when(kernel.anyMessage).thenReturn({ connect: noop, disconnect: noop } as any);
        when(kernel.unhandledMessage).thenReturn(
            instance(mock<ISignal<Kernel.IKernelConnection, KernelMessage.IMessage<KernelMessage.MessageType>>>())
        );
        when(kernel.disposed).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, void>>()));
        when(kernel.connectionStatusChanged).thenReturn(
            instance(mock<ISignal<Kernel.IKernelConnection, Kernel.ConnectionStatus>>())
        );
        when(kernel.info).thenResolve(kernelInfo);
        when(kernel.requestKernelInfo()).thenCall(async () => {
            iopubMessage.emit(someIOPubMessage);
            return kernelInfoResponse;
        });
        when(kernel.connectionStatus).thenReturn('connected');

        nonSerializingKernel.KernelConnection = function (options: { serverSettings: ServerConnection.ISettings }) {
            new options.serverSettings.WebSocket('http://1234');
            return instance(kernel);
        } as any;
        return kernel;
    }
    setup(() => {
        exitedEvent = new EventEmitter<{
            exitCode?: number | undefined;
            reason?: string | undefined;
        }>();
        nonSerializingKernel.KernelConnection = OldKernelConnectionClass;
        token = new CancellationTokenSource();
        disposables.push(token);
        session = mock<RawSessionConnection>();
        kernelProcess = createKernelProcess();
        kernelLauncher = mock<IKernelLauncher>();
        kernel = createKernel();
        when(kernelLauncher.launch(anything(), anything(), anything(), anything(), anything())).thenResolve(
            resolvableInstance(kernelProcess)
        );

        session = new RawSessionConnection(
            Uri.file('one.ipynb'),
            instance(kernelLauncher),
            Uri.file(''),
            kernelConnectionMetadata,
            1_000,
            'notebook'
        );
    });

    teardown(async () => {
        nonSerializingKernel.KernelConnection = OldKernelConnectionClass;
        sinon.reset();
        disposeAllDisposables(disposables);
        await session
            .shutdown()
            .catch(noop)
            .finally(() => session.dispose());
    });
    suite('After Start', async () => {
        setup(async () => {
            const startupToken = new CancellationTokenSource();
            disposables.push(startupToken);
            await session.startKernel({ token: startupToken.token });
        });
        test('Verify kernel Status', async () => {
            when(kernel.status).thenReturn('idle');
            assert.strictEqual(session.status, 'idle');

            when(kernel.status).thenReturn('busy');
            assert.strictEqual(session.status, 'busy');
        });
        test('Kernel Dies when the Kernel process dies', async () => {
            let statusOfKernel: Kernel.Status | undefined;
            let disposed = false;
            session.kernel!.statusChanged.connect((_, s) => (statusOfKernel = s));
            session.kernel!.disposed.connect(() => (disposed = true));

            exitedEvent.fire({ exitCode: 1, reason: 'Killed' });

            await waitForCondition(
                () => !disposed && statusOfKernel === 'dead',
                1_000,
                () => `Kernel is not dead, Kernel Disposed = ${disposed} && Kernel Status = ${statusOfKernel}`
            );
            assert.strictEqual(session.status, 'dead');
            assert.strictEqual(session.isDisposed, false);
            assert.strictEqual(session.kernel?.isDisposed ?? false, false);
        });
        test('Dispose', async () => {
            let statusOfKernel: Kernel.Status | undefined;
            let disposed = false;
            session.statusChanged.connect((_, s) => (statusOfKernel = s));
            session.disposed.connect(() => (disposed = true));

            session.dispose();

            await waitForCondition(
                () => disposed && statusOfKernel === 'dead' && session.status === 'dead',
                1_000,
                () => `Session not terminated, Status = ${statusOfKernel} and current status = ${session.status}`
            );
            verify(kernelProcess.dispose()).once();
        });
        test('Shutdown', async () => {
            let statusOfKernel: Kernel.Status | undefined;
            let disposed = false;
            session.statusChanged.connect((_, s) => (statusOfKernel = s));
            session.disposed.connect(() => (disposed = true));

            await session.shutdown();

            assert.strictEqual(session.status, 'dead');
            assert.deepEqual(statusOfKernel, 'dead');
            assert.strictEqual(disposed, false);
            verify(kernelProcess.dispose()).once();
        });
        test.skip('Restart', async () => {
            const newKernel = createKernel();
            const newKernelProcess = createKernelProcess();
            when(kernelLauncher.launch(anything(), anything(), anything(), anything(), anything())).thenResolve(
                resolvableInstance(newKernelProcess)
            );

            const statuses: Kernel.Status[] = [];
            let disposed = false;
            session.statusChanged.connect((_, s) => statuses.push(s));
            session.disposed.connect(() => (disposed = true));

            await session.kernel?.restart();

            assert.strictEqual(session.status, 'idle');
            assert.deepEqual(statuses, ['restarting', 'idle']);
            assert.strictEqual(disposed, false);
            verify(kernelProcess.dispose()).once();

            // Verify we return the status of the new kernel and not the old kernel
            when(kernel.status).thenReturn('busy');
            assert.strictEqual(session.status, 'idle');
            when(newKernel.status).thenReturn('busy');
            assert.strictEqual(session.status, 'busy');
        });
    });
});
