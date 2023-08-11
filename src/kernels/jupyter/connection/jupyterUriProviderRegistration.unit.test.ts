// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { assert, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { anything, instance, mock, reset, verify, when } from 'ts-mockito';
import {
    JupyterUriProviderRegistration,
    REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY
} from './jupyterUriProviderRegistration';
import { IJupyterServerUriEntry, IJupyterServerUriStorage } from '../types';
import { IDisposable, IExtensions } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IJupyterServerUri, IJupyterUriProvider } from '../../../api';
import { IServiceContainer } from '../../../platform/ioc/types';
import { Disposable, EventEmitter, Memento, QuickPickItem } from 'vscode';
import { createEventHandler } from '../../../test/common';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { DataScience } from '../../../platform/common/utils/localize';
use(chaiAsPromised);

suite('Uri Provider Registration', () => {
    const disposables: IDisposable[] = [];
    let extensions: IExtensions;
    let globalMemento: Memento;
    let serviceContainer: IServiceContainer;
    let uriStorage: IJupyterServerUriStorage;
    let registration: JupyterUriProviderRegistration;
    let onDidRemoveServer: EventEmitter<IJupyterServerUriEntry[]>;
    let clock: fakeTimers.InstalledClock;
    setup(async () => {
        extensions = mock<IExtensions>();
        globalMemento = mock<Memento>();
        serviceContainer = mock<IServiceContainer>();
        uriStorage = mock<IJupyterServerUriStorage>();
        onDidRemoveServer = new EventEmitter<IJupyterServerUriEntry[]>();
        when(globalMemento.get(REGISTRATION_ID_EXTENSION_OWNER_MEMENTO_KEY, anything())).thenCall(
            (_, defaultValue) => defaultValue
        );
        when(uriStorage.onDidRemove).thenReturn(onDidRemoveServer.event);
        when(serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage)).thenReturn(instance(uriStorage));
        when(extensions.all).thenReturn([]);
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));

        registration = new JupyterUriProviderRegistration(
            instance(extensions),
            disposables,
            instance(globalMemento),
            instance(serviceContainer)
        );
        registration.activate();
        await clock.runAllAsync();
    });
    teardown(() => disposeAllDisposables(disposables));
    test('No Providers registered', async () => {
        assert.deepEqual(registration.providers, [], 'Providers should be empty');

        await clock.runAllAsync();
        assert.deepEqual(registration.providers, [], 'Providers should be empty');
    });
    test('No Providers registered even after activating extension that seems to have a Jupyter Provider', async () => {
        let activatedRightExtension = false;
        let activatedWrongExtension = false;
        when(extensions.all).thenReturn([
            {
                activate: () => {
                    activatedRightExtension = true;
                    return Promise.resolve();
                },
                id: 'xyz',
                isActive: false,
                packageJSON: { contributes: { pythonRemoteServerProvider: {} } } as any
            } as any,
            {
                activate: () => {
                    activatedWrongExtension = true;
                    return Promise.resolve();
                },
                id: 'xyz',
                isActive: false
            } as any
        ]);

        assert.deepEqual(registration.providers, [], 'Providers should be empty');

        await clock.runAllAsync();

        assert.deepEqual(registration.providers, [], 'Providers should be empty');
        assert.strictEqual(activatedRightExtension, true, 'Extension should have been activated');
        assert.strictEqual(activatedWrongExtension, false, 'Extension should not have been activated');
    });
    test('Once a provider is registered trigger a change event', async () => {
        const eventHandler = createEventHandler(registration, 'onDidChangeProviders', disposables);

        assert.deepEqual(registration.providers, [], 'Providers should be empty');

        const provider1 = createAndRegisterJupyterUriProvider('ext', '1');

        assert.strictEqual(registration.providers.length, 1);
        assert.strictEqual(registration.providers[0].extensionId, 'ext');
        assert.strictEqual(registration.providers[0].id, '1');
        assert.strictEqual(eventHandler.count, 1);

        const provider2 = createAndRegisterJupyterUriProvider('ext', '2');
        assert.strictEqual(registration.providers.length, 2);
        assert.strictEqual(eventHandler.count, 2);

        // Now remove provider 1
        provider1.disposable.dispose();

        assert.strictEqual(registration.providers.length, 1);
        assert.strictEqual(registration.providers[0].extensionId, 'ext');
        assert.strictEqual(registration.providers[0].id, '2');
        assert.strictEqual(eventHandler.count, 3);

        provider2.disposable.dispose();

        assert.strictEqual(registration.providers.length, 0);
        assert.strictEqual(eventHandler.count, 4);
    });
    test('Cannot register the same provider twice', async () => {
        const eventHandler = createEventHandler(registration, 'onDidChangeProviders', disposables);

        assert.deepEqual(registration.providers, [], 'Providers should be empty');

        createAndRegisterJupyterUriProvider('ext', '1');

        assert.strictEqual(registration.providers.length, 1);
        assert.strictEqual(eventHandler.count, 1);

        assert.throws(() => createAndRegisterJupyterUriProvider('ext', '1'));
    });
    test('Get a provider by id', async () => {
        createAndRegisterJupyterUriProvider('a', '1');
        createAndRegisterJupyterUriProvider('b', '2');

        assert.strictEqual((await registration.getProvider('a', '1'))?.extensionId, 'a');
        assert.strictEqual((await registration.getProvider('b', '2'))?.extensionId, 'b');
        assert.isUndefined(await registration.getProvider('x', '3'));
    });
    test('Throws an error when getting a server for an invalid item', async () => {
        const { provider: provider1 } = createAndRegisterJupyterUriProvider('ext', 'a');
        const { provider: provider2 } = createAndRegisterJupyterUriProvider('ext', 'b');
        when(provider1.getHandles!()).thenResolve(['handle1', 'handle2']);
        when(provider2.getHandles!()).thenResolve(['handlea', 'handleb']);

        await assert.isRejected(
            registration.getJupyterServerUri({ id: 'unknownId', handle: 'unknownHandle', extensionId: '' })
        );
        await assert.isRejected(
            registration.getJupyterServerUri({ id: 'a', handle: 'unknownHandle', extensionId: '' })
        );
        await assert.isRejected(
            registration.getJupyterServerUri({ id: 'b', handle: 'unknownHandle', extensionId: '' })
        );
    });
    test('Get a Jupyter Server by handle', async () => {
        const { provider: provider1 } = createAndRegisterJupyterUriProvider('ext', 'a');
        const { provider: provider2 } = createAndRegisterJupyterUriProvider('ext', 'b');
        when(provider1.getHandles!()).thenResolve(['handle1', 'handle2']);
        when(provider2.getHandles!()).thenResolve(['handlea', 'handleb']);
        const serverForHandle1 = mock<IJupyterServerUri>();
        when(serverForHandle1.baseUrl).thenReturn('http://server1/');
        when(serverForHandle1.displayName).thenReturn('Server 1');
        const serverForHandleB = mock<IJupyterServerUri>();
        when(serverForHandleB.baseUrl).thenReturn('http://serverB/');
        when(serverForHandleB.displayName).thenReturn('Server B');
        when(provider1.getServerUri('handle1')).thenResolve(resolvableInstance(serverForHandle1));
        when(provider2.getServerUri('handleb')).thenResolve(resolvableInstance(serverForHandleB));

        const server = await registration.getJupyterServerUri({ id: 'a', handle: 'handle1', extensionId: 'ext' });
        assert.strictEqual(server.displayName, 'Server 1');
        assert.strictEqual(server, instance(serverForHandle1));

        const server2 = await registration.getJupyterServerUri({ id: 'b', handle: 'handleb', extensionId: 'ext' });
        assert.strictEqual(server2.displayName, 'Server B');
        assert.strictEqual(server2, instance(serverForHandleB));
    });
    test('Notify the provider when a server is deleted', async () => {
        const { provider: provider1 } = createAndRegisterJupyterUriProvider('ext', 'a');
        const { provider: provider2 } = createAndRegisterJupyterUriProvider('ext', 'b');
        when(provider1.getHandles!()).thenResolve(['handle1', 'handle2']);
        when(provider2.getHandles!()).thenResolve(['handlea', 'handleb']);
        when(provider1.removeHandle!(anything())).thenResolve();
        when(provider2.removeHandle!(anything())).thenResolve();

        const removedServer: IJupyterServerUriEntry = {
            provider: { handle: 'handle2', id: 'a', extensionId: 'ext' },
            time: Date.now(),
            displayName: 'Server for Handle2'
        };
        onDidRemoveServer.fire([removedServer]);
        await clock.runAllAsync();

        verify(provider1.removeHandle!('handle1')).never();
        verify(provider1.removeHandle!('handle2')).once();
        verify(provider2.removeHandle!(anything())).never();
    });
    test('Verify the handles', async () => {
        const { provider: mockProvider } = createAndRegisterJupyterUriProvider('a', '1');
        when(mockProvider.getHandles!()).thenResolve(['handle1', 'handle2']);

        const provider = await registration.getProvider('a', '1');

        assert.deepEqual(await provider!.getHandles!(), ['handle1', 'handle2']);
    });
    test('Verify onDidChangeHandles is triggered', async () => {
        const { provider: mockProvider, onDidChangeHandles } = createAndRegisterJupyterUriProvider('a', '1');
        when(mockProvider.getHandles!()).thenResolve(['handle1', 'handle2']);

        const provider = await registration.getProvider('a', '1');
        const eventHandler = createEventHandler(provider!, 'onDidChangeHandles', disposables);

        onDidChangeHandles.fire();

        assert.strictEqual(eventHandler.count, 1);
    });
    test('Verify not Quick Pick items are returned if there are none', async () => {
        const { provider: mockProvider, onDidChangeHandles } = createAndRegisterJupyterUriProvider('a', '1');
        when(mockProvider.getQuickPickEntryItems).thenReturn(undefined);

        const provider = await registration.getProvider('a', '1');

        onDidChangeHandles.fire();

        assert.deepEqual(await provider!.getQuickPickEntryItems!(), []);
    });
    test('Returns a list of the quick pick items', async () => {
        const { provider: mockProvider1 } = createAndRegisterJupyterUriProvider('a', '1');
        const { provider: mockProvider2 } = createAndRegisterJupyterUriProvider('ext2', 'b');
        const quickPickItemsForHandle1: QuickPickItem[] = [
            {
                label: 'Item 1'
            },
            { label: 'Item 2' }
        ];
        const quickPickItemsForHandle2: QuickPickItem[] = [
            {
                label: 'Item X'
            },
            { label: 'Item Y' }
        ];
        when(mockProvider1.getQuickPickEntryItems!(anything())).thenResolve(quickPickItemsForHandle1 as any);
        when(mockProvider2.getQuickPickEntryItems!(anything())).thenResolve(quickPickItemsForHandle2 as any);

        const provider1 = await registration.getProvider('a', '1');
        const provider2 = await registration.getProvider('ext2', 'b');

        assert.deepEqual(
            await provider1!.getQuickPickEntryItems!(),
            quickPickItemsForHandle1.map((item) => {
                return {
                    ...item,
                    description: DataScience.uriProviderDescriptionFormat(item.description || '', 'a'),
                    original: item
                };
            })
        );
        assert.deepEqual(
            await provider2!.getQuickPickEntryItems!(),
            quickPickItemsForHandle2.map((item) => {
                return {
                    ...item,
                    description: DataScience.uriProviderDescriptionFormat(item.description || '', 'ext2'),
                    original: item
                };
            })
        );
    });
    test('Handles the selection of a quick pick item', async () => {
        const { provider: mockProvider1 } = createAndRegisterJupyterUriProvider('a', '1');
        const { provider: mockProvider2 } = createAndRegisterJupyterUriProvider('ext2', 'b');
        when(mockProvider1.handleQuickPick!(anything(), anything())).thenResolve();
        when(mockProvider2.handleQuickPick!(anything(), anything())).thenResolve();
        const quickPickItemsForHandle1: QuickPickItem[] = [
            {
                label: 'Item 1'
            },
            { label: 'Item 2' }
        ];
        const quickPickItemsForHandle2: QuickPickItem[] = [
            {
                label: 'Item X'
            },
            { label: 'Item Y' }
        ];
        when(mockProvider1.getQuickPickEntryItems!()).thenResolve(quickPickItemsForHandle1 as any);
        when(mockProvider2.getQuickPickEntryItems!()).thenResolve(quickPickItemsForHandle2 as any);

        const provider1 = await registration.getProvider('a', '1');
        const provider2 = await registration.getProvider('ext2', 'b');

        await provider1?.handleQuickPick!(
            { ...quickPickItemsForHandle1[0], original: quickPickItemsForHandle1[0] } as any,
            false
        );

        verify(mockProvider1.handleQuickPick!(quickPickItemsForHandle1[0], false)).once();
        verify(mockProvider2.handleQuickPick!(anything(), anything())).never();
        reset(mockProvider1);

        await provider2?.handleQuickPick!(
            { ...quickPickItemsForHandle2[1], original: quickPickItemsForHandle2[1] } as any,
            true
        );

        verify(mockProvider1.handleQuickPick!(anything(), anything())).never();
        verify(mockProvider2.handleQuickPick!(quickPickItemsForHandle2[1], true)).once();
    });

    function createAndRegisterJupyterUriProvider(extensionId: string, id: string, disposables: IDisposable[] = []) {
        const provider = mock<IJupyterUriProvider>();
        const onDidChangeHandles = new EventEmitter<void>();
        disposables.push(onDidChangeHandles);
        when(provider.onDidChangeHandles).thenReturn(onDidChangeHandles.event);
        when(provider.id).thenReturn(id);

        when(extensions.getExtension(extensionId)).thenReturn({
            activate: () => {
                return Promise.resolve();
            },
            id: extensionId,
            isActive: false,
            packageJSON: { contributes: { pythonRemoteServerProvider: {} } } as any
        } as any);

        const disposable = registration.registerProvider(instance(provider), extensionId);
        return { provider, disposable, onDidChangeHandles };
    }
});
