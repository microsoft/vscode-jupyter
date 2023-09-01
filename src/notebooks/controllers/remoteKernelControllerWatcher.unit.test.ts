// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter } from 'vscode';
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import {
    IJupyterServerUriStorage,
    IInternalJupyterUriProvider,
    IJupyterUriProviderRegistration,
    IJupyterServerProviderRegistry,
    JupyterServerProviderHandle
} from '../../kernels/jupyter/types';
import {
    IJupyterKernelSpec,
    LiveKernelModel,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../kernels/types';
import { RemoteKernelControllerWatcher } from './remoteKernelControllerWatcher';
import { IControllerRegistration, IVSCodeNotebookController } from './types';
import { dispose } from '../../platform/common/helpers';
import { IDisposable } from '../../platform/common/types';
import { waitForCondition } from '../../test/common';
import { JupyterServerCollection } from '../../api';
import { noop } from '../../test/core';

suite('RemoteKernelControllerWatcher', () => {
    let watcher: RemoteKernelControllerWatcher;
    const disposables: IDisposable[] = [];
    let uriProviderRegistration: IJupyterUriProviderRegistration;
    let uriStorage: IJupyterServerUriStorage;
    let controllers: IControllerRegistration;
    let onDidChangeProviders: EventEmitter<void>;
    let jupyterServerProviderRegistry: IJupyterServerProviderRegistry;
    let onDidChangeJupyterServerCollections: EventEmitter<{
        added: JupyterServerCollection[];
        removed: JupyterServerCollection[];
    }>;
    let clock: fakeTimers.InstalledClock;
    setup(() => {
        uriProviderRegistration = mock<IJupyterUriProviderRegistration>();
        uriStorage = mock<IJupyterServerUriStorage>();
        controllers = mock<IControllerRegistration>();
        jupyterServerProviderRegistry = mock<IJupyterServerProviderRegistry>();
        onDidChangeProviders = new EventEmitter<void>();
        disposables.push(onDidChangeProviders);
        onDidChangeJupyterServerCollections = new EventEmitter<{
            added: JupyterServerCollection[];
            removed: JupyterServerCollection[];
        }>();
        disposables.push(onDidChangeJupyterServerCollections);
        when(jupyterServerProviderRegistry.onDidChangeCollections).thenReturn(
            onDidChangeJupyterServerCollections.event
        );
        when(jupyterServerProviderRegistry.jupyterCollections).thenReturn([]);
        when(uriProviderRegistration.onDidChangeProviders).thenReturn(onDidChangeProviders.event);
        when(uriStorage.remove(anything())).thenResolve();
        watcher = new RemoteKernelControllerWatcher(
            disposables,
            instance(uriProviderRegistration),
            instance(uriStorage),
            instance(controllers),
            instance(jupyterServerProviderRegistry)
        );
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => {
        dispose(disposables);
    });

    test('Dispose controllers associated with an old handle', async () => {
        const provider1Id = 'provider1';
        const provider1Handle1: string = 'provider1Handle1';
        const serverProviderHandle = { handle: provider1Handle1, id: provider1Id, extensionId: '1' };
        const remoteUriForProvider1 = generateIdFromRemoteProvider(serverProviderHandle);
        let onDidChangeHandles: undefined | (() => Promise<void>);
        const provider1 = mock<IInternalJupyterUriProvider>();
        when(provider1.id).thenReturn(provider1Id);
        when(provider1.extensionId).thenReturn('1');
        when(provider1.getHandles!()).thenResolve([provider1Handle1]);
        when(provider1.onDidChangeHandles).thenReturn(
            (cb: Function, ctx: Object) => (onDidChangeHandles = cb.bind(ctx))
        );

        const provider2 = mock<IInternalJupyterUriProvider>();
        when(provider2.id).thenReturn('provider2');
        when(provider2.getHandles).thenReturn(undefined);
        when(provider2.onDidChangeHandles).thenReturn(undefined);

        const provider3 = mock<IInternalJupyterUriProvider>();
        let onDidChangeHandles3: undefined | (() => Promise<void>);
        when(provider3.id).thenReturn('provider3');
        when(provider3.getHandles!()).thenResolve(['provider3Handle1']);
        when(provider3.onDidChangeHandles).thenReturn(
            (cb: Function, ctx: Object) => (onDidChangeHandles3 = cb.bind(ctx))
        );

        when(uriProviderRegistration.providers).thenReturn([
            instance(provider1),
            instance(provider2),
            instance(provider3)
        ]);

        const localKernel = createControllerForLocalKernelSpec('local1');
        const remoteKernelSpec = createControllerForRemoteKernelSpec(
            'remote1',
            remoteUriForProvider1,
            serverProviderHandle
        );
        const remoteLiveKernel = createControllerForRemoteLiveKernel(
            'live1',
            remoteUriForProvider1,
            serverProviderHandle
        );
        when(controllers.registered).thenReturn([
            instance(localKernel),
            instance(remoteKernelSpec),
            instance(remoteLiveKernel)
        ]);

        when(uriStorage.getAll()).thenResolve([
            {
                time: 1,
                displayName: 'Something',
                provider: {
                    handle: provider1Handle1,
                    id: provider1Id,
                    extensionId: '1'
                }
            }
        ]);
        when(uriStorage.add(anything())).thenResolve();
        when(uriStorage.add(anything(), anything())).thenResolve();

        watcher.activate();

        clock.runAllAsync().catch(noop);
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
        verify(uriStorage.remove(anything())).never();
        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).never();
        verify(remoteLiveKernel.dispose()).never();

        // 4. When we trigger a change in the handles, & different handles are returned, then
        // Verify that the old controllers have been disposed.
        when(provider1.getHandles!()).thenResolve(['somethingElse']);
        await onDidChangeHandles!();

        assert.isOk(onDidChangeHandles, 'onDidChangeHandles should be defined');
        verify(uriStorage.remove(deepEqual(serverProviderHandle))).once();
        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).once();
        verify(remoteLiveKernel.dispose()).once();
    });
    function createControllerForLocalKernelSpec(id: string) {
        const localKernel = mock<IVSCodeNotebookController>();
        when(localKernel.dispose()).thenReturn();
        when(localKernel.connection).thenReturn(
            LocalKernelSpecConnectionMetadata.create({
                id,
                kernelSpec: mock<IJupyterKernelSpec>()
            })
        );
        return localKernel;
    }
    function createControllerForRemoteKernelSpec(
        id: string,
        baseUrl: string,
        serverProviderHandle: JupyterServerProviderHandle
    ) {
        const remoteKernelSpec = mock<IVSCodeNotebookController>();
        when(remoteKernelSpec.dispose()).thenReturn();
        when(remoteKernelSpec.connection).thenReturn(
            RemoteKernelSpecConnectionMetadata.create({
                id,
                baseUrl,
                kernelSpec: mock<IJupyterKernelSpec>(),
                serverProviderHandle
            })
        );
        return remoteKernelSpec;
    }
    function createControllerForRemoteLiveKernel(
        id: string,
        baseUrl: string,
        serverProviderHandle: JupyterServerProviderHandle
    ) {
        const remoteLiveKernel = mock<IVSCodeNotebookController>();
        when(remoteLiveKernel.dispose()).thenReturn();
        when(remoteLiveKernel.connection).thenReturn(
            LiveRemoteKernelConnectionMetadata.create({
                id,
                baseUrl,
                kernelModel: mock<LiveKernelModel>(),
                serverProviderHandle
            })
        );
        return remoteLiveKernel;
    }
    test('Dispose controllers associated with an Jupyter Collection', async () => {
        when(uriProviderRegistration.providers).thenReturn([]);
        const localKernel = createControllerForLocalKernelSpec('local1');
        const remoteKernelSpecExt1Coll1Server1 = createControllerForRemoteKernelSpec('remote1', 'http://server1:8888', {
            extensionId: '1',
            id: '1',
            handle: '1'
        });
        const remoteKernelSpecExt1Coll1Server2 = createControllerForRemoteKernelSpec('remote2', 'http://server1:8888', {
            extensionId: '1',
            id: '1',
            handle: '2'
        });
        const remoteLiveKernelExt1Coll1Server1 = createControllerForRemoteLiveKernel('live1', 'http://server1:8888', {
            extensionId: '1',
            id: '1',
            handle: '2'
        });
        const remoteKernelSpecExt1Col2Server1 = createControllerForRemoteKernelSpec('remote2', 'http://server2:8888', {
            extensionId: '1',
            id: '2',
            handle: '1'
        });
        const remoteLiveKernelExt1Col2Server1 = createControllerForRemoteLiveKernel('live2', 'http://server2:8888', {
            extensionId: '1',
            id: '2',
            handle: '1'
        });
        const remoteKernelSpecExt2Col1Server1 = createControllerForRemoteKernelSpec('remote2', 'http://another:8888', {
            extensionId: '2',
            id: '1',
            handle: '1'
        });
        const remoteKernelSpecExt2Col2Server1 = createControllerForRemoteLiveKernel('live2', 'http://another:8888', {
            extensionId: '2',
            id: '2',
            handle: '1'
        });
        const remoteControllers: IVSCodeNotebookController[] = [
            instance(remoteKernelSpecExt1Coll1Server1),
            instance(remoteKernelSpecExt1Coll1Server2),
            instance(remoteLiveKernelExt1Coll1Server1),
            instance(remoteKernelSpecExt1Col2Server1),
            instance(remoteLiveKernelExt1Col2Server1),
            instance(remoteKernelSpecExt2Col1Server1),
            instance(remoteKernelSpecExt2Col2Server1)
        ];
        const remoteProviderHandles = remoteControllers
            .map((k) => k.connection as RemoteKernelConnectionMetadata)
            .map((c) => c.serverProviderHandle);
        when(controllers.registered).thenReturn([instance(localKernel), ...remoteControllers]);
        when(uriStorage.getAll()).thenResolve(
            remoteProviderHandles.map((s) => ({
                time: 1,
                displayName: `Server ${s.handle} Collection ${s.id} for Ext ${s.extensionId}`,
                provider: s
            }))
        );
        when(uriStorage.add(anything())).thenResolve();
        when(uriStorage.add(anything(), anything())).thenResolve();

        const validServersInCollection1OfExt1 = Array.from(
            new Set(remoteProviderHandles.filter((s) => s.extensionId === '1' && s.id === '1').map((s) => s.handle))
        ).map((s) => ({ id: s, label: s }));
        const onDidChangeServers = new EventEmitter<void>();
        const onDidChangeProviders = new EventEmitter<void>();
        const collection1OfExt1: JupyterServerCollection = {
            extensionId: '1',
            id: '1',
            label: '1',
            dispose: noop,
            onDidChangeProvider: onDidChangeProviders.event,
            serverProvider: {
                onDidChangeServers: onDidChangeServers.event,
                provideJupyterServers: async () => validServersInCollection1OfExt1,
                resolveJupyterServer: () => Promise.reject(new Error('Not Supported'))
            }
        };
        when(jupyterServerProviderRegistry.jupyterCollections).thenReturn([collection1OfExt1]);

        watcher.activate();
        await clock.runAllAsync();

        // We know initially there are only 2 servers for the first collection in extension 1
        assert.deepEqual(validServersInCollection1OfExt1, [
            { id: '1', label: '1' },
            { id: '2', label: '2' }
        ]);

        // Verify no controllers were disposed.
        verify(remoteKernelSpecExt1Coll1Server1.dispose()).never();
        verify(remoteKernelSpecExt1Coll1Server2.dispose()).never();
        verify(remoteKernelSpecExt2Col1Server1.dispose()).never();
        verify(remoteKernelSpecExt2Col2Server1.dispose()).never();
        verify(uriStorage.remove(anything())).never();

        // 1. Now remove the first server and trigger a change.
        validServersInCollection1OfExt1.splice(0, 1);
        onDidChangeServers.fire();
        await clock.runAllAsync();

        // Verify we removed the right controllers
        verify(remoteKernelSpecExt1Coll1Server1.dispose()).once();
        verify(remoteKernelSpecExt1Coll1Server2.dispose()).never();
        verify(uriStorage.remove(deepEqual({ extensionId: '1', id: '1', handle: '1' }))).once();
        verify(uriStorage.remove(deepEqual({ extensionId: '1', id: '1', handle: '2' }))).never();

        // 2. Dispose the collection 1 and verify the remaining servers were disposed.
        onDidChangeJupyterServerCollections.fire({ added: [], removed: [collection1OfExt1] });
        await clock.runAllAsync();

        // Verify we removed the right controllers
        verify(remoteKernelSpecExt1Coll1Server2.dispose()).once();
        verify(remoteKernelSpecExt2Col1Server1.dispose()).never();
        verify(remoteKernelSpecExt2Col2Server1.dispose()).never();
        verify(uriStorage.remove(deepEqual({ extensionId: '1', id: '1', handle: '1' }))).once();
        // Just because the collection was removed, do not remove the MRU, possible the server is still valid.
        verify(uriStorage.remove(deepEqual({ extensionId: '1', id: '1', handle: '2' }))).never();
    });
});
