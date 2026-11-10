// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as sinon from 'sinon';
import * as fakeTimers from '@sinonjs/fake-timers';
import { assert, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, Uri } from 'vscode';
import { noop } from '../../../test/core';
import { IJupyterConnection, IKernelProvider } from '../../types';
import {
    IJupyterRemoteCachedKernelValidator,
    IJupyterServerProviderRegistry,
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    IRemoteKernelFinder,
    JupyterServerProviderHandle
} from '../types';
import { KernelFinder } from '../../kernelFinder';
import { IApplicationEnvironment } from '../../../platform/common/application/types';
import { IExtensionContext } from '../../../platform/common/types';
import { RemoteKernelFinder } from './remoteKernelFinder';
import { JupyterConnection } from '../connection/jupyterConnection';
import { DisposableStore, dispose } from '../../../platform/common/utils/lifecycle';
import { IFileSystem } from '../../../platform/common/platform/types';
import { RemoteKernelFinderController } from './remoteKernelFinderController';
import { JupyterServerCollection, JupyterServerProvider } from '../../../api';
import { UserJupyterServerPickerProviderId } from '../../../platform/constants';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../../test/constants';
import { createDeferred } from '../../../platform/common/utils/async';

use(chaiAsPromised);

suite(`Remote Kernel Finder Controller`, () => {
    let disposables: Disposable[] = [];
    const connInfo: IJupyterConnection = {
        baseUrl: 'http://foobar',
        displayName: 'foobar connection',
        token: '',
        providerId: 'a',
        hostName: 'foobar',
        rootDirectory: Uri.file('.'),
        dispose: noop,
        serverProviderHandle: { handle: 'handle', id: 'id', extensionId: '' },
        settings: {} as any
    };
    const globalStorageUri = Uri.file('globalStorage');
    const serverEntry = {
        uri: connInfo.baseUrl,
        time: Date.now(),
        isValidated: true,
        provider: {
            id: UserJupyterServerPickerProviderId,
            handle: '2',
            extensionId: JVSC_EXTENSION_ID_FOR_TESTS
        }
    };
    let serverUriStorage: IJupyterServerUriStorage;
    let env: IApplicationEnvironment;
    let cachedRemoteKernelValidator: IJupyterRemoteCachedKernelValidator;
    let kernelFinder: KernelFinder;
    let kernelProvider: IKernelProvider;
    let jupyterConnection: JupyterConnection;
    let fs: IFileSystem;
    let context: IExtensionContext;
    let jupyterServerProviderRegistry: IJupyterServerProviderRegistry;
    let kernelFinderController: RemoteKernelFinderController;
    let disposableStore: DisposableStore;
    let clock: fakeTimers.InstalledClock;
    let serverAdded: EventEmitter<IJupyterServerUriEntry>;
    setup(() => {
        clock = fakeTimers.install();
        disposableStore = new DisposableStore();
        disposables.push(disposableStore);
        disposableStore.add(new Disposable(() => clock.uninstall()));

        serverUriStorage = mock<IJupyterServerUriStorage>();
        serverAdded = disposableStore.add(new EventEmitter<IJupyterServerUriEntry>());
        when(serverUriStorage.all).thenReturn([]);
        when(serverUriStorage.onDidAdd).thenReturn(serverAdded.event);
        when(serverUriStorage.onDidChange).thenReturn(disposableStore.add(new EventEmitter<void>()).event);
        when(serverUriStorage.onDidLoad).thenReturn(disposableStore.add(new EventEmitter<void>()).event);
        when(serverUriStorage.onDidRemove).thenReturn(
            disposableStore.add(new EventEmitter<JupyterServerProviderHandle[]>()).event
        );

        env = mock<IApplicationEnvironment>();
        cachedRemoteKernelValidator = mock<IJupyterRemoteCachedKernelValidator>();
        kernelFinder = mock<KernelFinder>();
        kernelProvider = mock<IKernelProvider>();
        jupyterConnection = mock<JupyterConnection>();
        fs = mock<IFileSystem>();
        context = mock<IExtensionContext>();
        jupyterServerProviderRegistry = mock<IJupyterServerProviderRegistry>();
        when(jupyterServerProviderRegistry.onDidChangeCollections).thenReturn(
            disposableStore.add(
                new EventEmitter<{
                    added: JupyterServerCollection[];
                    removed: JupyterServerCollection[];
                }>()
            ).event
        );
        when(jupyterServerProviderRegistry.jupyterCollections).thenReturn([]);
        when(kernelFinder.registerKernelFinder(anything())).thenReturn(new Disposable(noop));
        when(context.globalStorageUri).thenReturn(globalStorageUri);
        kernelFinderController = new RemoteKernelFinderController(
            instance(serverUriStorage),
            instance(env),
            instance(cachedRemoteKernelValidator),
            instance(kernelFinder),
            instance(kernelProvider),
            instance(jupyterConnection),
            disposables,
            instance(fs),
            instance(context),
            instance(jupyterServerProviderRegistry)
        );
    });
    teardown(() => {
        sinon.restore();
        disposables = dispose(disposables);
    });
    test('Do not use old API for user provided kernels', async () => {
        let displayNameOfKernelProvider = '';
        sinon.stub(RemoteKernelFinder.prototype, 'activate').callsFake(function (this: RemoteKernelFinder) {
            displayNameOfKernelProvider = this.displayName;
            return Promise.resolve();
        });
        const collectionForRemote = mock<JupyterServerCollection>();
        when(collectionForRemote.id).thenReturn(UserJupyterServerPickerProviderId);
        when(collectionForRemote.label).thenReturn('Quick Label');
        when(collectionForRemote.extensionId).thenReturn(JVSC_EXTENSION_ID_FOR_TESTS);
        const serverProvider = mock<JupyterServerProvider>();
        when(serverProvider.provideJupyterServers(anything())).thenResolve();
        when(collectionForRemote.serverProvider).thenReturn(instance(serverProvider));

        when(jupyterServerProviderRegistry.jupyterCollections).thenReturn([instance(collectionForRemote)]);
        when(serverUriStorage.all).thenReturn([serverEntry]);

        kernelFinderController.activate();
        await clock.runAllAsync();

        assert.isEmpty(displayNameOfKernelProvider, 'Old API should not be used for user provided kernels');
    });
    test('Kernel discovery returns the finder for the requested server', async () => {
        const collection = mock<JupyterServerCollection>();
        const serverProvider = mock<JupyterServerProvider>();
        const refresh = sinon.stub();
        const finder = { refresh } as unknown as IRemoteKernelFinder;
        const server = { id: 'server-1', label: 'Server One' };
        const providerHandle: JupyterServerProviderHandle = {
            extensionId: 'publisher.extension',
            id: 'collection-1',
            handle: server.id
        };
        when(collection.extensionId).thenReturn(providerHandle.extensionId);
        when(collection.id).thenReturn(providerHandle.id);
        when(collection.serverProvider).thenReturn(instance(serverProvider));
        when(serverProvider.provideJupyterServers(anything())).thenReturn(Promise.resolve([server]));
        when(serverUriStorage.add(deepEqual(providerHandle))).thenResolve();
        const getFinder = sinon.stub(kernelFinderController, 'getOrCreateRemoteKernelFinder').returns(finder);

        const result = await kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), server.id);

        assert.strictEqual(result, finder);
        verify(serverUriStorage.add(deepEqual(providerHandle))).once();
        sinon.assert.calledOnceWithExactly(getFinder, providerHandle, server.label);
        sinon.assert.notCalled(refresh);
    });
    test('Concurrent kernel discovery calls share the same server start', async () => {
        const collection = mock<JupyterServerCollection>();
        const provideJupyterServers = sinon.stub();
        const serverProvider = { provideJupyterServers } as unknown as JupyterServerProvider;
        const providerResult = createDeferred<{ id: string; label: string }[]>();
        const finder = {} as IRemoteKernelFinder;
        const server = { id: 'server-1', label: 'Server One' };
        const providerHandle: JupyterServerProviderHandle = {
            extensionId: 'publisher.extension',
            id: 'collection-1',
            handle: server.id
        };
        when(collection.extensionId).thenReturn(providerHandle.extensionId);
        when(collection.id).thenReturn(providerHandle.id);
        when(collection.serverProvider).thenReturn(serverProvider);
        provideJupyterServers.returns(providerResult.promise);
        when(serverUriStorage.add(deepEqual(providerHandle))).thenResolve();
        const getFinder = sinon.stub(kernelFinderController, 'getOrCreateRemoteKernelFinder').returns(finder);

        const firstStart = kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), server.id);
        const secondStart = kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), server.id);
        providerResult.resolve([server]);
        const [firstResult, secondResult] = await Promise.all([firstStart, secondStart]);

        assert.strictEqual(secondStart, firstStart);
        assert.strictEqual(firstResult, finder);
        assert.strictEqual(secondResult, finder);
        sinon.assert.calledOnce(provideJupyterServers);
        verify(serverUriStorage.add(deepEqual(providerHandle))).once();
        sinon.assert.calledOnceWithExactly(getFinder, providerHandle, server.label);
    });
    test('Concurrent kernel discovery calls share provider rejection', async () => {
        const collection = mock<JupyterServerCollection>();
        const provideJupyterServers = sinon.stub();
        const serverProvider = { provideJupyterServers } as unknown as JupyterServerProvider;
        const providerResult = createDeferred<{ id: string; label: string }[]>();
        const providerFailure = new Error('Provider failed');
        when(collection.extensionId).thenReturn('publisher.extension');
        when(collection.id).thenReturn('collection-1');
        when(collection.serverProvider).thenReturn(serverProvider);
        provideJupyterServers.returns(providerResult.promise);
        const getFinder = sinon.stub(kernelFinderController, 'getOrCreateRemoteKernelFinder');

        const firstStart = kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), 'server-1');
        const secondStart = kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), 'server-1');
        providerResult.reject(providerFailure);
        const [firstError, secondError] = await Promise.all([
            firstStart.catch((ex) => ex),
            secondStart.catch((ex) => ex)
        ]);

        assert.strictEqual(secondStart, firstStart);
        assert.strictEqual(firstError, providerFailure);
        assert.strictEqual(secondError, providerFailure);
        sinon.assert.calledOnce(provideJupyterServers);
        verify(serverUriStorage.add(anything())).never();
        sinon.assert.notCalled(getFinder);
    });
    test('Kernel discovery can retry after an in-flight storage rejection', async () => {
        const collection = mock<JupyterServerCollection>();
        const provideJupyterServers = sinon.stub();
        const serverProvider = { provideJupyterServers } as unknown as JupyterServerProvider;
        const finder = {} as IRemoteKernelFinder;
        const storageFailure = new Error('Storage failed');
        const server = { id: 'server-1', label: 'Server One' };
        const providerHandle: JupyterServerProviderHandle = {
            extensionId: 'publisher.extension',
            id: 'collection-1',
            handle: server.id
        };
        let storageAttempts = 0;
        when(collection.extensionId).thenReturn(providerHandle.extensionId);
        when(collection.id).thenReturn(providerHandle.id);
        when(collection.serverProvider).thenReturn(serverProvider);
        provideJupyterServers.resolves([server]);
        when(serverUriStorage.add(deepEqual(providerHandle))).thenCall(() => {
            storageAttempts += 1;
            return storageAttempts === 1 ? Promise.reject(storageFailure) : Promise.resolve();
        });
        const getFinder = sinon.stub(kernelFinderController, 'getOrCreateRemoteKernelFinder').returns(finder);

        await assert.isRejected(
            kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), server.id),
            storageFailure.message
        );
        const result = await kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), server.id);

        assert.strictEqual(result, finder);
        sinon.assert.calledTwice(provideJupyterServers);
        assert.strictEqual(storageAttempts, 2);
        sinon.assert.calledOnceWithExactly(getFinder, providerHandle, server.label);
    });
    test('Concurrent kernel discovery calls for different servers remain independent', async () => {
        const collection = mock<JupyterServerCollection>();
        const provideJupyterServers = sinon.stub();
        const serverProvider = { provideJupyterServers } as unknown as JupyterServerProvider;
        const firstProviderResult = createDeferred<{ id: string; label: string }[]>();
        const secondProviderResult = createDeferred<{ id: string; label: string }[]>();
        const firstFinder = {} as IRemoteKernelFinder;
        const secondFinder = {} as IRemoteKernelFinder;
        const firstServer = { id: 'server-1', label: 'Server One' };
        const secondServer = { id: 'server-2', label: 'Server Two' };
        const firstProviderHandle: JupyterServerProviderHandle = {
            extensionId: 'publisher.extension',
            id: 'collection-1',
            handle: firstServer.id
        };
        const secondProviderHandle: JupyterServerProviderHandle = {
            ...firstProviderHandle,
            handle: secondServer.id
        };
        when(collection.extensionId).thenReturn(firstProviderHandle.extensionId);
        when(collection.id).thenReturn(firstProviderHandle.id);
        when(collection.serverProvider).thenReturn(serverProvider);
        provideJupyterServers.onFirstCall().returns(firstProviderResult.promise);
        provideJupyterServers.onSecondCall().returns(secondProviderResult.promise);
        when(serverUriStorage.add(deepEqual(firstProviderHandle))).thenResolve();
        when(serverUriStorage.add(deepEqual(secondProviderHandle))).thenResolve();
        const getFinder = sinon
            .stub(kernelFinderController, 'getOrCreateRemoteKernelFinder')
            .callsFake((providerHandle) => (providerHandle.handle === firstServer.id ? firstFinder : secondFinder));

        const firstStart = kernelFinderController.startJupyterServerKernelDiscovery(
            instance(collection),
            firstServer.id
        );
        const secondStart = kernelFinderController.startJupyterServerKernelDiscovery(
            instance(collection),
            secondServer.id
        );
        await Promise.resolve();
        firstProviderResult.resolve([firstServer, secondServer]);
        secondProviderResult.resolve([firstServer, secondServer]);
        const [firstResult, secondResult] = await Promise.all([firstStart, secondStart]);

        assert.notStrictEqual(secondStart, firstStart);
        assert.strictEqual(firstResult, firstFinder);
        assert.strictEqual(secondResult, secondFinder);
        sinon.assert.calledTwice(provideJupyterServers);
        verify(serverUriStorage.add(deepEqual(firstProviderHandle))).once();
        verify(serverUriStorage.add(deepEqual(secondProviderHandle))).once();
        sinon.assert.calledTwice(getFinder);
    });
    test('Kernel discovery returns an active finder when later provider enumeration rejects', async () => {
        const collection = mock<JupyterServerCollection>();
        const provideJupyterServers = sinon.stub();
        const serverProvider = { provideJupyterServers } as unknown as JupyterServerProvider;
        const server = { id: 'server-1', label: 'Server One' };
        const providerHandle: JupyterServerProviderHandle = {
            extensionId: 'publisher.extension',
            id: 'collection-1',
            handle: server.id
        };
        when(collection.extensionId).thenReturn(providerHandle.extensionId);
        when(collection.id).thenReturn(providerHandle.id);
        when(collection.serverProvider).thenReturn(serverProvider);
        provideJupyterServers.onFirstCall().resolves([server]);
        provideJupyterServers.onSecondCall().rejects(new Error('Provider failed'));
        when(serverUriStorage.add(deepEqual(providerHandle))).thenResolve();
        const activate = sinon.stub(RemoteKernelFinder.prototype, 'activate').resolves();
        const refresh = sinon.stub(RemoteKernelFinder.prototype, 'refresh').resolves();

        const firstResult = await kernelFinderController.startJupyterServerKernelDiscovery(
            instance(collection),
            server.id
        );
        const secondResult = await kernelFinderController.startJupyterServerKernelDiscovery(
            instance(collection),
            server.id
        );

        assert.strictEqual(secondResult, firstResult);
        sinon.assert.calledOnce(provideJupyterServers);
        verify(serverUriStorage.add(deepEqual(providerHandle))).once();
        sinon.assert.calledOnce(activate);
        sinon.assert.notCalled(refresh);
    });
    test('Kernel discovery returns an active finder when later provider enumeration omits the server', async () => {
        const collection = mock<JupyterServerCollection>();
        const provideJupyterServers = sinon.stub();
        const serverProvider = { provideJupyterServers } as unknown as JupyterServerProvider;
        const server = { id: 'server-1', label: 'Server One' };
        const providerHandle: JupyterServerProviderHandle = {
            extensionId: 'publisher.extension',
            id: 'collection-1',
            handle: server.id
        };
        when(collection.extensionId).thenReturn(providerHandle.extensionId);
        when(collection.id).thenReturn(providerHandle.id);
        when(collection.serverProvider).thenReturn(serverProvider);
        provideJupyterServers.onFirstCall().resolves([server]);
        provideJupyterServers.onSecondCall().resolves([]);
        when(serverUriStorage.add(deepEqual(providerHandle))).thenResolve();
        const activate = sinon.stub(RemoteKernelFinder.prototype, 'activate').resolves();
        const refresh = sinon.stub(RemoteKernelFinder.prototype, 'refresh').resolves();

        const firstResult = await kernelFinderController.startJupyterServerKernelDiscovery(
            instance(collection),
            server.id
        );
        const secondResult = await kernelFinderController.startJupyterServerKernelDiscovery(
            instance(collection),
            server.id
        );

        assert.strictEqual(secondResult, firstResult);
        sinon.assert.calledOnce(provideJupyterServers);
        verify(serverUriStorage.add(deepEqual(providerHandle))).once();
        sinon.assert.calledOnce(activate);
        sinon.assert.notCalled(refresh);
    });
    test('Kernel discovery rejects an unknown server id', async () => {
        const collection = mock<JupyterServerCollection>();
        const serverProvider = mock<JupyterServerProvider>();
        when(collection.extensionId).thenReturn('publisher.extension');
        when(collection.id).thenReturn('collection-1');
        when(collection.serverProvider).thenReturn(instance(serverProvider));
        when(serverProvider.provideJupyterServers(anything())).thenReturn(
            Promise.resolve([{ id: 'server-1', label: 'Server One' }])
        );
        const getFinder = sinon.stub(kernelFinderController, 'getOrCreateRemoteKernelFinder');

        await assert.isRejected(
            kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), 'missing-server'),
            "Jupyter Server 'missing-server' was not found in collection 'collection-1'."
        );

        verify(serverUriStorage.add(anything())).never();
        sinon.assert.notCalled(getFinder);
    });
    test('Kernel discovery propagates provider failures', async () => {
        const collection = mock<JupyterServerCollection>();
        const serverProvider = mock<JupyterServerProvider>();
        when(collection.extensionId).thenReturn('publisher.extension');
        when(collection.id).thenReturn('collection-1');
        when(collection.serverProvider).thenReturn(instance(serverProvider));
        when(serverProvider.provideJupyterServers(anything())).thenReject(new Error('Provider failed'));
        const getFinder = sinon.stub(kernelFinderController, 'getOrCreateRemoteKernelFinder');

        await assert.isRejected(
            kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), 'server-1'),
            'Provider failed'
        );

        verify(serverUriStorage.add(anything())).never();
        sinon.assert.notCalled(getFinder);
    });
    test('Kernel discovery propagates storage failures', async () => {
        const collection = mock<JupyterServerCollection>();
        const serverProvider = mock<JupyterServerProvider>();
        const server = { id: 'server-1', label: 'Server One' };
        const providerHandle: JupyterServerProviderHandle = {
            extensionId: 'publisher.extension',
            id: 'collection-1',
            handle: server.id
        };
        when(collection.extensionId).thenReturn(providerHandle.extensionId);
        when(collection.id).thenReturn(providerHandle.id);
        when(collection.serverProvider).thenReturn(instance(serverProvider));
        when(serverProvider.provideJupyterServers(anything())).thenReturn(Promise.resolve([server]));
        when(serverUriStorage.add(deepEqual(providerHandle))).thenReject(new Error('Storage failed'));
        const getFinder = sinon.stub(kernelFinderController, 'getOrCreateRemoteKernelFinder');

        await assert.isRejected(
            kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), server.id),
            'Storage failed'
        );

        sinon.assert.notCalled(getFinder);
    });
    test('Kernel discovery does not enumerate the provider again through in-flight storage events', async () => {
        const collection = mock<JupyterServerCollection>();
        const serverProvider = mock<JupyterServerProvider>();
        const finder = {} as IRemoteKernelFinder;
        const server = { id: 'server-1', label: 'Server One' };
        const providerHandle: JupyterServerProviderHandle = {
            extensionId: 'publisher.extension',
            id: 'collection-1',
            handle: server.id
        };
        when(collection.extensionId).thenReturn(providerHandle.extensionId);
        when(collection.id).thenReturn(providerHandle.id);
        when(collection.serverProvider).thenReturn(instance(serverProvider));
        when(serverProvider.provideJupyterServers(anything())).thenReturn(Promise.resolve([server]));
        when(serverUriStorage.add(deepEqual(providerHandle))).thenCall(() => {
            serverAdded.fire({ provider: providerHandle, time: Date.now(), displayName: '' });
            return Promise.resolve();
        });
        const getFinder = sinon.stub(kernelFinderController, 'getOrCreateRemoteKernelFinder').returns(finder);
        kernelFinderController.activate();
        when(jupyterServerProviderRegistry.jupyterCollections).thenReturn([instance(collection)]);

        const result = await kernelFinderController.startJupyterServerKernelDiscovery(instance(collection), server.id);

        assert.strictEqual(result, finder);
        verify(serverProvider.provideJupyterServers(anything())).once();
        sinon.assert.calledOnceWithExactly(getFinder, providerHandle, server.label);
    });
});
