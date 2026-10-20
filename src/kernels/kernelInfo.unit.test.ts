// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { Memento } from 'vscode';
import { instance, mock, when } from 'ts-mockito';
import { getKernelInfo } from './kernelInfo';
import { IRawKernelSession, LocalKernelSpecConnectionMetadata } from './types';
import { createDeferred } from '../platform/common/utils/async';

suite('Kernel info startup readiness', () => {
    function info(banner: string): KernelMessage.IInfoReply {
        return {
            status: 'ok',
            banner,
            protocol_version: '5.3',
            implementation: 'ipython',
            implementation_version: '9.17.1',
            language_info: { name: 'python', version: '3.14.6' },
            help_links: []
        };
    }

    function response(banner: string) {
        return KernelMessage.createMessage({
            msgType: 'kernel_info_reply',
            channel: 'shell',
            username: 'fixture',
            session: 'fixture',
            content: info(banner)
        });
    }

    function create() {
        const kernel = mock<Kernel.IKernelConnection>();
        const session = mock<IRawKernelSession>();
        const fresh = createDeferred<KernelMessage.IInfoReplyMsg>();
        when(session.kernel).thenReturn(instance(kernel));
        when(kernel.info).thenResolve(info('cached'));
        when(kernel.requestKernelInfo()).thenReturn(fresh.promise);
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: 'fixture',
            kernelSpec: { name: 'python3', display_name: 'Fixture', argv: ['python'], executable: 'python' }
        });
        return { session: instance(session), metadata, fresh, storage: instance(mock<Memento>()) };
    }

    test('unaffected callers retain cached-info behavior', async () => {
        const value = create();
        const result = await getKernelInfo(value.session, value.metadata, value.storage);
        assert.deepEqual(result, info('cached'));
        value.fresh.resolve(response('fresh'));
    });

    test('affected startup must await the real fresh request, not cached info', async () => {
        const value = create();
        let completed = false;
        const result = getKernelInfo(value.session, value.metadata, value.storage, true);
        void result.then(() => (completed = true));
        await Promise.resolve();
        await Promise.resolve();
        assert.isFalse(completed);
        value.fresh.resolve(response('fresh'));
        assert.deepEqual(await result, info('fresh'));
    });

    test('a failed fresh request cannot be converted into cached readiness', async () => {
        const value = create();
        const failure = new Error('fixture request failed');
        const result = getKernelInfo(value.session, value.metadata, value.storage, true).catch(
            (error: unknown) => error
        );
        value.fresh.reject(failure);
        assert.strictEqual(await result, failure);
    });
});
