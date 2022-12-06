// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter } from 'vscode';
import { computeServerId, generateUriFromRemoteProvider } from '../../../../kernels/jupyter/jupyterUtils';
import {
    IJupyterServerUriStorage,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    JupyterServerUriHandle
} from '../../../../kernels/jupyter/types';
import {
    IJupyterKernelSpec,
    LiveKernelModel,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../../../kernels/types';
import { RemoteKernelControllerWatcher } from '../../../../notebooks/controllers/remoteKernelControllerWatcher';
import { IControllerRegistry, IVSCodeNotebookController } from '../../../../notebooks/controllers/types';
import { disposeAllDisposables } from '../../../../platform/common/helpers';
import { IDisposable } from '../../../../platform/common/types';
import { waitForCondition } from '../../../common';

suite('RemoteKernelControllerWatcher', () => {
    let watcher: RemoteKernelControllerWatcher;
    const disposables: IDisposable[] = [];
    let uriProviderRegistration: IJupyterUriProviderRegistration;
    let uriStorage: IJupyterServerUriStorage;
    let controllers: IControllerRegistry;
    let onDidChangeProviders: EventEmitter<void>;
    setup(() => {
        uriProviderRegistration = mock<IJupyterUriProviderRegistration>();
        uriStorage = mock<IJupyterServerUriStorage>();
        controllers = mock<IControllerRegistry>();
        onDidChangeProviders = new EventEmitter<void>();
        disposables.push(onDidChangeProviders);
        when(uriProviderRegistration.onDidChangeProviders).thenReturn(onDidChangeProviders.event);
        when(uriStorage.removeUri(anything())).thenResolve();
        watcher = new RemoteKernelControllerWatcher(
            disposables,
            instance(uriProviderRegistration),
            instance(uriStorage),
            instance(controllers)
        );
    });
    teardown(() => {
        disposeAllDisposables(disposables);
    });

    test('Dispose controllers associated with an old handle', async () => {
        const provider1Id = 'provider1';
        const provider1Handle1: JupyterServerUriHandle = 'provider1Handle1';
        const remoteUriForProvider1 = generateUriFromRemoteProvider(provider1Id, provider1Handle1);
        const serverId = await computeServerId(remoteUriForProvider1);

        let onDidChangeHandles: undefined | (() => Promise<void>);
        const provider1 = mock<IJupyterUriProvider>();
        when(provider1.id).thenReturn(provider1Id);
        when(provider1.getHandles!()).thenResolve([provider1Handle1]);
        when(provider1.onDidChangeHandles).thenReturn(
            (cb: Function, ctx: Object) => (onDidChangeHandles = cb.bind(ctx))
        );

        const provider2 = mock<IJupyterUriProvider>();
        when(provider2.id).thenReturn('provider2');
        when(provider2.getHandles).thenReturn(undefined);
        when(provider2.onDidChangeHandles).thenReturn(undefined);

        const provider3 = mock<IJupyterUriProvider>();
        let onDidChangeHandles3: undefined | (() => Promise<void>);
        when(provider3.id).thenReturn('provider3');
        when(provider3.getHandles!()).thenResolve(['provider3Handle1']);
        when(provider3.onDidChangeHandles).thenReturn(
            (cb: Function, ctx: Object) => (onDidChangeHandles3 = cb.bind(ctx))
        );

        when(uriProviderRegistration.getProviders()).thenResolve([
            instance(provider1),
            instance(provider2),
            instance(provider3)
        ]);

        const localKernel = mock<IVSCodeNotebookController>();
        when(localKernel.dispose()).thenReturn();
        when(localKernel.connection).thenReturn(
            LocalKernelSpecConnectionMetadata.create({
                id: 'local1',
                kernelSpec: mock<IJupyterKernelSpec>()
            })
        );
        const remoteKernelSpec = mock<IVSCodeNotebookController>();
        when(remoteKernelSpec.dispose()).thenReturn();
        when(remoteKernelSpec.connection).thenReturn(
            RemoteKernelSpecConnectionMetadata.create({
                id: 'remote1',
                baseUrl: remoteUriForProvider1,
                kernelSpec: mock<IJupyterKernelSpec>(),
                serverId
            })
        );
        const remoteLiveKernel = mock<IVSCodeNotebookController>();
        when(remoteLiveKernel.dispose()).thenReturn();
        when(remoteLiveKernel.connection).thenReturn(
            LiveRemoteKernelConnectionMetadata.create({
                id: 'live1',
                baseUrl: remoteUriForProvider1,
                kernelModel: mock<LiveKernelModel>(),
                serverId
            })
        );
        when(controllers.registered).thenReturn([
            instance(localKernel),
            instance(remoteKernelSpec),
            instance(remoteLiveKernel)
        ]);

        when(uriStorage.getSavedUriList()).thenResolve([
            { time: 1, serverId, uri: remoteUriForProvider1, displayName: 'Something' }
        ]);

        watcher.activate();

        await waitForCondition(
            async () => {
                verify(provider1.onDidChangeHandles).atLeast(1);
                return true;
            },
            5_000,
            'Timed out waiting for onDidChangeHandles to be called'
        );

        // 1. Verify that none of the controllers were disposed.
        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).never();
        verify(remoteLiveKernel.dispose()).never();

        // 2. When a provider triggers a change in its handles and we're not using its handles, then none of the controllers should get disposed.
        when(provider1.getHandles!()).thenResolve([provider1Handle1]);
        await onDidChangeHandles3!();

        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).never();
        verify(remoteLiveKernel.dispose()).never();

        // 3. When we trigger a change in the handles, but the same handles are still returned, then
        // Verify that none of the controllers were disposed.
        when(provider1.getHandles!()).thenResolve([provider1Handle1]);
        await onDidChangeHandles!();

        assert.isOk(onDidChangeHandles, 'onDidChangeHandles should be defined');
        verify(uriStorage.removeUri(anything())).never();
        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).never();
        verify(remoteLiveKernel.dispose()).never();

        // 4. When we trigger a change in the handles, & different handles are returned, then
        // Verify that the old controllers have been disposed.
        when(provider1.getHandles!()).thenResolve(['somethingElse']);
        await onDidChangeHandles!();

        assert.isOk(onDidChangeHandles, 'onDidChangeHandles should be defined');
        verify(uriStorage.removeUri(remoteUriForProvider1)).once();
        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).once();
        verify(remoteLiveKernel.dispose()).once();
    });
});
