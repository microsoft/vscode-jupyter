// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { Memento, Uri } from 'vscode';
import {
    IJupyterKernelSpec,
    LiveKernelModel,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../kernels/types';
import { IExtensionContext } from '../../platform/common/types';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { TestNotebookDocument } from '../../test/datascience/notebook/executionHelper';
import { ConnectionMru, MRUListKey, WorkspaceMRUList } from './connectionMru.web';
import { IKernelRankingHelper } from './types';

suite('Connection MRU (web)', () => {
    let mru: ConnectionMru;
    let rankingHelper: IKernelRankingHelper;
    let context: IExtensionContext;
    let workspaceState: Memento;
    const remoteKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        id: 'remote',
        serverId: '',
        baseUrl: 'http://bogus.com',
        kernelSpec: instance(mock<IJupyterKernelSpec>())
    });
    const remoteLiveKernel = LiveRemoteKernelConnectionMetadata.create({
        id: 'live',
        serverId: '',
        baseUrl: 'http://bogus.com',
        kernelModel: instance(mock<LiveKernelModel>())
    });
    const notebook = new TestNotebookDocument(Uri.file('notebook1.ipynb'));
    setup(() => {
        rankingHelper = mock<IKernelRankingHelper>();
        context = mock<IExtensionContext>();
        workspaceState = mock<Memento>();
        when(context.storageUri).thenReturn(Uri.file('workspaceStorage'));
        when(context.workspaceState).thenReturn(instance(workspaceState));
        when(rankingHelper.isExactMatch(anything(), anything(), anything())).thenResolve(false);
        when(workspaceState.get(anything(), anything())).thenCall((_, defaultValue) => defaultValue);
        mru = new ConnectionMru(instance(rankingHelper), instance(context));
    });

    test('No MRU items for first time users', async () => {
        const exists = await mru.exists(notebook, remoteKernelSpec);

        assert.isFalse(exists);
    });
    test('Update MRU', async () => {
        await mru.add(notebook, remoteKernelSpec);
        const exists = await mru.exists(notebook, remoteKernelSpec);

        assert.isTrue(exists);
    });
    test('Update storage when updating MRU', async () => {
        assert.isFalse(await mru.exists(notebook, remoteKernelSpec));
        assert.isFalse(await mru.exists(notebook, remoteLiveKernel));

        await mru.add(notebook, remoteKernelSpec);

        assert.isTrue(await mru.exists(notebook, remoteKernelSpec));
        assert.isFalse(await mru.exists(notebook, remoteLiveKernel));
        verify(workspaceState.update(anything(), anything())).atLeast(1);
        let json = JSON.parse(capture(workspaceState.update).first()[1] as string) as WorkspaceMRUList;
        const nbUriHash = await getTelemetrySafeHashedString(notebook.uri.toString());
        assert.strictEqual(json[nbUriHash][0][1], await remoteKernelSpec.getHashId());

        await mru.add(notebook, remoteLiveKernel);

        assert.isTrue(await mru.exists(notebook, remoteKernelSpec));
        assert.isTrue(await mru.exists(notebook, remoteLiveKernel));
        verify(workspaceState.update(anything(), anything())).atLeast(2);
        json = JSON.parse(capture(workspaceState.update).second()[1] as string) as WorkspaceMRUList;
        assert.strictEqual(json[nbUriHash][0][1], await remoteKernelSpec.getHashId());
        assert.strictEqual(json[nbUriHash][1][1], await remoteLiveKernel.getHashId());
    });
    test('Load MRU from state', async () => {
        const nbUriHash = await getTelemetrySafeHashedString(notebook.uri.toString());
        when(workspaceState.get(MRUListKey, anything())).thenReturn(
            JSON.stringify({
                [nbUriHash]: [[1, await remoteKernelSpec.getHashId()]]
            })
        );
        assert.isTrue(await mru.exists(notebook, remoteKernelSpec));
        assert.isFalse(await mru.exists(notebook, remoteLiveKernel));
    });
    test('Load MRU from state (with more than one item)', async () => {
        const nbUriHash = await getTelemetrySafeHashedString(notebook.uri.toString());
        when(workspaceState.get(MRUListKey, anything())).thenReturn(
            JSON.stringify({
                [nbUriHash]: [
                    [1, await remoteKernelSpec.getHashId()],
                    [2, await remoteLiveKernel.getHashId()]
                ]
            })
        );
        assert.isTrue(await mru.exists(notebook, remoteKernelSpec));
        assert.isTrue(await mru.exists(notebook, remoteLiveKernel));
    });
    test('Update existing MRUs', async () => {
        const nbUriHash = await getTelemetrySafeHashedString(notebook.uri.toString());
        when(workspaceState.get(MRUListKey, anything())).thenReturn(
            JSON.stringify({
                [nbUriHash]: [
                    [1, await remoteKernelSpec.getHashId()],
                    [2, await remoteLiveKernel.getHashId()]
                ]
            })
        );
        assert.isTrue(await mru.exists(notebook, remoteKernelSpec));
        assert.isTrue(await mru.exists(notebook, remoteLiveKernel));

        await mru.add(notebook, remoteKernelSpec);

        verify(workspaceState.update(anything(), anything())).atLeast(1);
        let json = JSON.parse(capture(workspaceState.update).first()[1] as string) as WorkspaceMRUList;
        assert.isAtLeast(json[nbUriHash][0][0], Date.now() - 60 * 1000);
        assert.strictEqual(json[nbUriHash][1][0], 2);

        await mru.add(notebook, remoteLiveKernel);

        verify(workspaceState.update(anything(), anything())).atLeast(1);
        json = JSON.parse(capture(workspaceState.update).second()[1] as string) as WorkspaceMRUList;
        assert.isAtLeast(json[nbUriHash][0][0], Date.now() - 60 * 1000);
        assert.isAtLeast(json[nbUriHash][1][0], Date.now() - 60 * 1000);
    });
    test('Use different MRUs per notebook document', async () => {
        const notebook2 = new TestNotebookDocument(Uri.file('notebook2.ipynb'));

        assert.isFalse(await mru.exists(notebook, remoteKernelSpec));
        assert.isFalse(await mru.exists(notebook, remoteLiveKernel));
        assert.isFalse(await mru.exists(notebook2, remoteKernelSpec));
        assert.isFalse(await mru.exists(notebook2, remoteLiveKernel));

        await mru.add(notebook, remoteKernelSpec);

        assert.isTrue(await mru.exists(notebook, remoteKernelSpec));
        assert.isFalse(await mru.exists(notebook, remoteLiveKernel));
        assert.isFalse(await mru.exists(notebook2, remoteKernelSpec));
        assert.isFalse(await mru.exists(notebook2, remoteLiveKernel));

        await mru.add(notebook2, remoteLiveKernel);

        assert.isTrue(await mru.exists(notebook, remoteKernelSpec));
        assert.isFalse(await mru.exists(notebook, remoteLiveKernel));
        assert.isFalse(await mru.exists(notebook2, remoteKernelSpec));
        assert.isTrue(await mru.exists(notebook2, remoteLiveKernel));

        await Promise.all([mru.add(notebook, remoteLiveKernel), mru.add(notebook2, remoteKernelSpec)]);

        assert.isTrue(await mru.exists(notebook, remoteKernelSpec));
        assert.isTrue(await mru.exists(notebook, remoteLiveKernel));
        assert.isTrue(await mru.exists(notebook2, remoteKernelSpec));
        assert.isTrue(await mru.exists(notebook2, remoteLiveKernel));
    });
});
