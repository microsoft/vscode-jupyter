// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento, Uri } from 'vscode';
import {
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    JupyterServerProviderHandle
} from '../../../kernels/jupyter/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposable, IExtensionContext } from '../../../platform/common/types';
import { JupyterServerUriStorage, StorageMRUItem } from './serverUriStorage';
import { JVSC_EXTENSION_ID, Settings, UserJupyterServerPickerProviderId } from '../../../platform/common/constants';
import { TestEventHandler, createEventHandler } from '../../../test/common';
import { generateIdFromRemoteProvider } from '../jupyterUtils';
import { sleep } from '../../../test/core';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';

suite('Server Uri Storage', async () => {
    let serverUriStorage: IJupyterServerUriStorage;
    let memento: Memento;
    let onDidRemoveUris: EventEmitter<IJupyterServerUriEntry[]>;
    let disposables: IDisposable[] = [];
    let context: IExtensionContext;
    let globalStorageUri = Uri.file('GlobalStorage');
    let onDidRemoveEvent: TestEventHandler<JupyterServerProviderHandle[]>;
    let onDidChangeEvent: TestEventHandler<void>;
    let onDidAddEvent: TestEventHandler<IJupyterServerUriEntry>;
    const machineId = 'SomeMachineId';
    const mementoKeyForStoringUsedJupyterProviders = `MEMENTO_KEY_FOR_STORING_USED_JUPYTER_PROVIDERS_${machineId}`;
    setup(() => {
        memento = mock<Memento>();
        context = mock<IExtensionContext>();
        onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
        disposables.push(onDidRemoveUris);
        when(mockedVSCodeNamespaces.env.machineId).thenReturn(machineId);
        when(context.globalStorageUri).thenReturn(globalStorageUri);
    });
    teardown(() => {
        disposables = dispose(disposables);
    });
    test('Clear when we have some old data', async () => {
        generateDummyData(2);

        await serverUriStorage.clear();

        verify(memento.update(mementoKeyForStoringUsedJupyterProviders, deepEqual([]))).once();

        // Event should be triggered indicating items have been removed
        await onDidRemoveEvent.assertFired(1);
        const items = onDidRemoveEvent.first;
        assert.strictEqual(items.length, 2);
    });
    test('Clear without any data', async () => {
        generateDummyData(0);
        when(memento.get(mementoKeyForStoringUsedJupyterProviders)).thenReturn([]);
        when(memento.update(mementoKeyForStoringUsedJupyterProviders, anything())).thenResolve();

        await serverUriStorage.clear();

        verify(memento.update(mementoKeyForStoringUsedJupyterProviders, deepEqual([]))).once();
        assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
    });
    test('Get All', async () => {
        const itemsInNewStorage = generateDummyData(2).slice();
        const all = serverUriStorage.all;
        assert.strictEqual(all.length, 2, 'Should have 2 items');
        assert.deepEqual(
            all
                .map((a) => {
                    return {
                        time: a.time,
                        displayName: a.displayName,
                        uri: generateIdFromRemoteProvider(a.provider)
                    };
                })
                .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
            itemsInNewStorage
                .map((a) => {
                    return {
                        time: a.time,
                        displayName: a.displayName,
                        uri: generateIdFromRemoteProvider(a.serverHandle)
                    };
                })
                .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
        );
    });

    test('Add new entry', async () => {
        const itemsInNewStorage = generateDummyData(2).slice();
        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        const all = serverUriStorage.all;
        assert.deepEqual(
            all
                .slice()
                .sort((a, b) => a.time - b.time)
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.provider)
                    };
                }),
            itemsInNewStorage
                .sort((a, b) => a.time - b.time)
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.serverHandle)
                    };
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId1',
                        handle: 'NewHandle1',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
        );

        assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
        assert.equal(onDidAddEvent.count, 1, 'Event should be fired once');
        assert.equal(onDidChangeEvent.count, 1, 'Event should be fired once');
    });
    test('Add new entry with time', async () => {
        generateDummyData(2);
        await serverUriStorage.add(
            { handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID },
            { time: 1234 }
        );
        const all = serverUriStorage.all;

        assert.strictEqual(all.find((a) => a.provider.handle === 'NewHandle1')?.time, 1234, 'Incorrect time');
    });
    test('Add three new entries', async () => {
        const itemsInNewStorage = generateDummyData(2).slice();
        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        const all = serverUriStorage.all;

        assert.deepEqual(
            all
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.provider)
                    };
                })
                .sort((a, b) => a.uri.localeCompare(b.uri)),
            itemsInNewStorage
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.serverHandle)
                    };
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId1',
                        handle: 'NewHandle1',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId2',
                        handle: 'NewHandle2',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId3',
                        handle: 'NewHandle3',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .sort((a, b) => a.uri.localeCompare(b.uri))
        );

        assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
        assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
        assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 3 times');
    });
    test('Add three new entries (without waiting)', async function () {
        const itemsInNewStorage = generateDummyData(2).slice();
        await Promise.all([
            serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID })
        ]);
        const all = serverUriStorage.all;

        assert.deepEqual(
            all
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.provider)
                    };
                })
                .sort((a, b) => a.uri.localeCompare(b.uri)),
            itemsInNewStorage
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.serverHandle)
                    };
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId1',
                        handle: 'NewHandle1',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId2',
                        handle: 'NewHandle2',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId3',
                        handle: 'NewHandle3',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .sort((a, b) => a.uri.localeCompare(b.uri))
        );

        assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
        assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
        assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 3 times');
    });
    test('Add three new entries (without waiting) & then remove one', async function () {
        const itemsInNewStorage = generateDummyData(2).slice();
        await Promise.all([
            serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID })
        ]);
        await serverUriStorage.remove({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID });
        const all = serverUriStorage.all;

        assert.deepEqual(
            all
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.provider)
                    };
                })
                .sort((a, b) => a.uri.localeCompare(b.uri)),
            itemsInNewStorage
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.serverHandle)
                    };
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId1',
                        handle: 'NewHandle1',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId3',
                        handle: 'NewHandle3',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .sort((a, b) => a.uri.localeCompare(b.uri))
        );

        assert.equal(onDidRemoveEvent.count, 1, 'Event should be fired once');
        assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
        assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 4 times (3 for add, one for remove)');
    });
    test('Add three new entries & then remove one', async function () {
        const itemsInNewStorage = generateDummyData(2).slice();
        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID });
        const all = serverUriStorage.all;

        assert.deepEqual(
            all
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.provider)
                    };
                })
                .sort((a, b) => a.uri.localeCompare(b.uri)),
            itemsInNewStorage
                .map((a) => {
                    return {
                        uri: generateIdFromRemoteProvider(a.serverHandle)
                    };
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId1',
                        handle: 'NewHandle1',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .concat({
                    uri: generateIdFromRemoteProvider({
                        id: 'NewId3',
                        handle: 'NewHandle3',
                        extensionId: JVSC_EXTENSION_ID
                    })
                })
                .sort((a, b) => a.uri.localeCompare(b.uri))
        );

        assert.equal(onDidRemoveEvent.count, 1, 'Event should be fired once');
        assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
        assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 4 times (3 for add, one for remove)');
    });
    test('Add three new entries (without waiting) & then remove all', async function () {
        generateDummyData(2);
        await Promise.all([
            serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID })
        ]);

        await serverUriStorage.remove({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({
            handle: 'handle1',
            id: UserJupyterServerPickerProviderId,
            extensionId: JVSC_EXTENSION_ID
        });
        await serverUriStorage.remove({
            handle: 'handle2',
            id: UserJupyterServerPickerProviderId,
            extensionId: JVSC_EXTENSION_ID
        });
        const all = serverUriStorage.all;

        assert.strictEqual(all.length, 0);
        assert.equal(
            onDidRemoveEvent.count,
            6,
            'Event should be fired 5 + 1 (extra for a debt issue, even if noting is removed we need to fire an event) times'
        );
        assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
        assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 4 times (3 for add, one for remove)');
    });
    test('Add three new entries (without waiting) & then remove all (without waiting)', async function () {
        generateDummyData(2);
        await Promise.all([
            serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID })
        ]);
        await Promise.all([
            serverUriStorage.remove({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.remove({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.remove({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.remove({
                handle: 'handle1',
                id: UserJupyterServerPickerProviderId,
                extensionId: JVSC_EXTENSION_ID
            }),
            serverUriStorage.remove({
                handle: 'handle2',
                id: UserJupyterServerPickerProviderId,
                extensionId: JVSC_EXTENSION_ID
            })
        ]);
        const all = serverUriStorage.all;

        assert.strictEqual(all.length, 0);
    });
    test('Add three new entries & then update one and remove one', async function () {
        generateDummyData(2);
        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        const beforeUpdate = serverUriStorage.all;
        const timeOfNewHandle2BeforeUpdate = beforeUpdate.find((item) => item.provider.handle === 'NewHandle2')!;
        assert.ok(timeOfNewHandle2BeforeUpdate);
        await sleep(10);
        await serverUriStorage.update({
            id: 'NewId2',
            handle: 'NewHandle2',
            extensionId: JVSC_EXTENSION_ID
        });
        const afterUpdate = serverUriStorage.all;
        const timeOfNewHandle2AfterUpdate = afterUpdate.find((item) => item.provider.handle === 'NewHandle2')!;
        assert.ok(timeOfNewHandle2BeforeUpdate);
        assert.ok(
            timeOfNewHandle2AfterUpdate.time > timeOfNewHandle2BeforeUpdate.time,
            `time ${timeOfNewHandle2AfterUpdate.time} should be greater than ${timeOfNewHandle2BeforeUpdate.time}`
        );
        await serverUriStorage.remove({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        const all = serverUriStorage.all;

        assert.strictEqual(all.length, 4);
        assert.equal(onDidRemoveEvent.count, 1, 'Event should be fired once');
        assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
        assert.equal(onDidChangeEvent.count, 4, 'Event should be fired 4 times (3 for add, once for add)');
    });
    test('Add three new entries & then remove all', async function () {
        generateDummyData(2);
        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({
            handle: 'handle1',
            id: UserJupyterServerPickerProviderId,
            extensionId: JVSC_EXTENSION_ID
        });
        await serverUriStorage.remove({
            handle: 'handle2',
            id: UserJupyterServerPickerProviderId,
            extensionId: JVSC_EXTENSION_ID
        });
        const all = serverUriStorage.all;

        assert.strictEqual(all.length, 0);
    });
    test('Add 10 new entries & add 11th, and add more and remove', async function () {
        generateDummyData(8);

        await serverUriStorage.add({ handle: 'NewHandle9', id: 'NewId9', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle10', id: 'NewId10', extensionId: JVSC_EXTENSION_ID });

        let all = serverUriStorage.all;
        assert.strictEqual(all.length, 10);
        assert.strictEqual(onDidRemoveEvent.count, 0, 'Event should not be fired');
        assert.strictEqual(onDidAddEvent.count, 2, 'Added 2 items');

        // MRU has a max of 10, once we add the 11th, the oldest one should be removed.
        let oldest = all.slice().sort((a, b) => a.time - b.time)[0];
        onDidAddEvent.reset();
        onDidRemoveEvent.reset();
        await serverUriStorage.add({ handle: 'NewHandle11', id: 'NewId11', extensionId: JVSC_EXTENSION_ID });

        all = serverUriStorage.all;
        assert.strictEqual(all.length, 10);
        assert.strictEqual(onDidRemoveEvent.count, 1, 'One should be automatically removed');
        assert.strictEqual(onDidAddEvent.count, 1, 'Added 1 items');
        assert.strictEqual(onDidRemoveEvent.first[0].handle, 'handle1');
        assert.strictEqual(onDidRemoveEvent.first[0].id, UserJupyterServerPickerProviderId);
        assert.strictEqual(onDidRemoveEvent.first[0].handle, oldest.provider.handle);
        assert.strictEqual(onDidRemoveEvent.first[0].id, oldest.provider.id);

        // Add (or update with the same item) does not remove any items.
        onDidAddEvent.reset();
        onDidRemoveEvent.reset();
        await serverUriStorage.add({ handle: 'NewHandle11', id: 'NewId11', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.update({
            id: 'NewId11',
            handle: 'NewHandle11',
            extensionId: JVSC_EXTENSION_ID
        });

        all = serverUriStorage.all;
        assert.strictEqual(all.length, 10);
        assert.strictEqual(onDidRemoveEvent.count, 0, 'One should be automatically removed');

        // Add another new item, then another will get removed automatically.
        oldest = all.slice().sort((a, b) => a.time - b.time)[0];
        onDidAddEvent.reset();
        onDidRemoveEvent.reset();
        await serverUriStorage.add({ handle: 'NewHandle12', id: 'NewId12', extensionId: JVSC_EXTENSION_ID });

        all = serverUriStorage.all;
        assert.strictEqual(all.length, 10);
        assert.strictEqual(onDidRemoveEvent.count, 1, 'One should be automatically removed');
        assert.strictEqual(onDidAddEvent.count, 1, 'Added 1 items');
        assert.strictEqual(onDidRemoveEvent.first[0].handle, 'handle2');
        assert.strictEqual(onDidRemoveEvent.first[0].id, UserJupyterServerPickerProviderId);
        assert.strictEqual(onDidRemoveEvent.first[0].handle, oldest.provider.handle);
        assert.strictEqual(onDidRemoveEvent.first[0].id, oldest.provider.id);
    });
    test('Can get existing items', async function () {
        generateDummyData(8);
        // Should exist.
        const time = serverUriStorage.all.find(
            (item) =>
                item.provider.id === UserJupyterServerPickerProviderId &&
                item.provider.extensionId === JVSC_EXTENSION_ID &&
                item.provider.handle === 'handle1'
        );

        assert.ok(time);

        // Remove this.
        await serverUriStorage.remove({
            handle: 'handle1',
            id: UserJupyterServerPickerProviderId,
            extensionId: JVSC_EXTENSION_ID
        });

        assert.isUndefined(
            serverUriStorage.all.find(
                (item) =>
                    item.provider.id === UserJupyterServerPickerProviderId &&
                    item.provider.extensionId === JVSC_EXTENSION_ID &&
                    item.provider.handle === 'handle1'
            )
        );

        // Bogus
        const noTime = serverUriStorage.all.find(
            (item) =>
                item.provider.id === 'Bogus' &&
                item.provider.extensionId === JVSC_EXTENSION_ID &&
                item.provider.handle === 'handle1'
        );
        assert.isUndefined(noTime);

        // Add and it should exist.
        await serverUriStorage.add({ handle: 'NewHandle11', id: 'NewId11', extensionId: JVSC_EXTENSION_ID });

        const hastTime = serverUriStorage.all.find(
            (item) =>
                item.provider.id === 'NewId11' &&
                item.provider.extensionId === JVSC_EXTENSION_ID &&
                item.provider.handle === 'NewHandle11'
        );

        assert.isOk(hastTime);
    });

    function generateDummyData(numberOfEntries: number = 2) {
        let data: StorageMRUItem[] = [];
        const uris: string[] = [];
        const itemsInNewStorage: StorageMRUItem[] = [];
        for (let index = 0; index < numberOfEntries; index += 1) {
            const uri = generateIdFromRemoteProvider({
                id: UserJupyterServerPickerProviderId,
                handle: `handle${index + 1}`,
                extensionId: JVSC_EXTENSION_ID
            });
            const displayName = `displayName${index}`;
            uris.push(`${uri}${Settings.JupyterServerRemoteLaunchNameSeparator}${displayName}`);
            data.push({
                displayName,
                time: Date.now() - 1000 + index,
                serverHandle: {
                    id: UserJupyterServerPickerProviderId,
                    handle: `handle${index + 1}`,
                    extensionId: JVSC_EXTENSION_ID
                }
            });
            itemsInNewStorage.push({
                displayName,
                serverHandle: {
                    id: UserJupyterServerPickerProviderId,
                    handle: `handle${index + 1}`,
                    extensionId: JVSC_EXTENSION_ID
                },
                time: Date.now() - 1000 + index
            });
        }
        when(memento.get(mementoKeyForStoringUsedJupyterProviders, anything())).thenReturn(data);
        when(memento.update(mementoKeyForStoringUsedJupyterProviders, anything())).thenCall((_, dataToStore) => {
            data.length = 0;
            data.push(...dataToStore);
            return Promise.resolve();
        });

        serverUriStorage = new JupyterServerUriStorage(instance(memento), disposables);
        onDidRemoveEvent = createEventHandler(serverUriStorage, 'onDidRemove', disposables);
        onDidChangeEvent = createEventHandler(serverUriStorage, 'onDidChange', disposables);
        onDidAddEvent = createEventHandler(serverUriStorage, 'onDidAdd', disposables);
        return itemsInNewStorage;
    }
});
