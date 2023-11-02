// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter } from 'vscode';
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import {
    IJupyterServerUriStorage,
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
import { dispose } from '../../platform/common/utils/lifecycle';
import { IDisposable } from '../../platform/common/types';
import { JupyterServer, JupyterServerCollection, JupyterServerProvider } from '../../api';
import { noop } from '../../test/core';

suite('RemoteKernelControllerWatcher', () => {
    let watcher: RemoteKernelControllerWatcher;
    let disposables: IDisposable[] = [];
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
        when(uriStorage.remove(anything())).thenResolve();
        watcher = new RemoteKernelControllerWatcher(
            disposables,
            instance(uriStorage),
            instance(controllers),
            instance(jupyterServerProviderRegistry)
        );
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => {
        disposables = dispose(disposables);
    });

    test('Dispose controllers associated with an old handle', async () => {
        const provider1Id = 'provider1';
        const provider1Handle1: string = 'provider1Handle1';
        const serverProviderHandle = { handle: provider1Handle1, id: provider1Id, extensionId: '1' };
        const remoteUriForProvider1 = generateIdFromRemoteProvider(serverProviderHandle);
        const collection1 = mock<JupyterServerCollection>();
        when(collection1.id).thenReturn(provider1Id);
        when(collection1.extensionId).thenReturn('1');
        const server1 = mock<JupyterServer>();
        when(server1.id).thenReturn(provider1Handle1);
        const serverProvider1DidChange1 = new EventEmitter<void>();
        disposables.push(serverProvider1DidChange1);
        const serverProvider1 = mock<JupyterServerProvider>();
        when(serverProvider1.provideJupyterServers(anything())).thenResolve([instance(server1)] as any);
        when(serverProvider1.onDidChangeServers).thenReturn(serverProvider1DidChange1.event);
        when(collection1.serverProvider).thenReturn(instance(serverProvider1));

        const collection2 = mock<JupyterServerCollection>();
        when(collection2.id).thenReturn('provider2');
        const serverProvider2 = mock<JupyterServerProvider>();
        when(serverProvider2.provideJupyterServers(anything())).thenResolve([] as any);
        when(collection2.serverProvider).thenReturn(instance(serverProvider2));
        const serverProvider1DidChange2 = new EventEmitter<void>();
        disposables.push(serverProvider1DidChange2);
        when(serverProvider2.onDidChangeServers).thenReturn(serverProvider1DidChange2.event);

        const collection3 = mock<JupyterServerCollection>();
        when(collection3.id).thenReturn('provider3');
        const server3 = mock<JupyterServer>();
        when(server3.id).thenReturn('provider3Handle1');
        const serverProvider3 = mock<JupyterServerProvider>();
        when(serverProvider3.provideJupyterServers(anything())).thenResolve([instance(server3)] as any);
        when(collection3.serverProvider).thenReturn(instance(serverProvider3));
        const serverProvider1DidChange3 = new EventEmitter<void>();
        disposables.push(serverProvider1DidChange3);
        when(serverProvider2.onDidChangeServers).thenReturn(serverProvider1DidChange3.event);
        when(jupyterServerProviderRegistry.jupyterCollections).thenReturn([
            instance(collection1),
            instance(collection2),
            instance(collection3)
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

        // const serversChanged = createEventHandler(instance(serverProvider1), 'onDidChangeServers');
        watcher.activate();
        await clock.runAllAsync().catch(noop);

        // 1. Verify that none of the controllers were disposed.
        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).never();
        verify(remoteLiveKernel.dispose()).never();

        // 2. When a provider triggers a change in its handles and we're not using its handles, then none of the controllers should get disposed.
        when(serverProvider1.provideJupyterServers(anything())).thenResolve([instance(server1)] as any);
        serverProvider1DidChange1.fire();
        await clock.runAllAsync();

        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).never();
        verify(remoteLiveKernel.dispose()).never();

        // 3. When we trigger a change in the handles, but the same handles are still returned, then
        // Verify that none of the controllers were disposed.
        when(serverProvider1.provideJupyterServers(anything())).thenResolve([instance(server1)] as any);
        serverProvider1DidChange1.fire!();
        await clock.runAllAsync();

        verify(uriStorage.remove(anything())).never();
        verify(localKernel.dispose()).never();
        verify(remoteKernelSpec.dispose()).never();
        verify(remoteLiveKernel.dispose()).never();

        // 4. When we trigger a change in the handles, & different handles are returned, then
        // Verify that the old controllers have been disposed.
        const server1A = mock<JupyterServer>();
        when(server1A.id).thenReturn('somethingElse');
        when(serverProvider1.provideJupyterServers(anything())).thenResolve([instance(server1A)] as any);
        serverProvider1DidChange1.fire!();
        await clock.runAllAsync();

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
        when(remoteKernelSpec.id).thenReturn(id);
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
