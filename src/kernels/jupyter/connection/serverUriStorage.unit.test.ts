// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento, Uri } from 'vscode';
import {
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../../../kernels/jupyter/types';
import { dispose } from '../../../platform/common/helpers';
import { IDisposable, IExtensionContext } from '../../../platform/common/types';
import { JupyterServerUriStorage, StorageMRUItem } from './serverUriStorage';
import { IEncryptedStorage } from '../../../platform/common/application/types';
import { IFileSystem } from '../../../platform/common/platform/types';
import { IJupyterServerUri } from '../../../api';
import { JVSC_EXTENSION_ID, Settings, UserJupyterServerPickerProviderId } from '../../../platform/common/constants';
import { TestEventHandler, createEventHandler } from '../../../test/common';
import { generateIdFromRemoteProvider } from '../jupyterUtils';
import { resolvableInstance, uriEquals } from '../../../test/datascience/helpers';
import { sleep } from '../../../test/core';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';

suite('Server Uri Storage', async () => {
    let serverUriStorage: IJupyterServerUriStorage;
    let memento: Memento;
    let onDidRemoveUris: EventEmitter<IJupyterServerUriEntry[]>;
    const disposables: IDisposable[] = [];
    let encryptedStorage: IEncryptedStorage;
    let jupyterPickerRegistration: IJupyterUriProviderRegistration;
    let fs: IFileSystem;
    let context: IExtensionContext;
    let globalStorageUri = Uri.file('GlobalStorage');
    let storageFile = Uri.joinPath(globalStorageUri, 'remoteServersMRUList.json');
    let onDidRemoveEvent: TestEventHandler<JupyterServerProviderHandle[]>;
    let onDidChangeEvent: TestEventHandler<void>;
    let onDidAddEvent: TestEventHandler<IJupyterServerUriEntry>;
    const machineId = 'SomeMachineId';
    const mementoKeyForStoringUsedJupyterProviders = `MEMENTO_KEY_FOR_STORING_USED_JUPYTER_PROVIDERS_${machineId}`;
    setup(() => {
        memento = mock<Memento>();
        encryptedStorage = mock<IEncryptedStorage>();
        jupyterPickerRegistration = mock<IJupyterUriProviderRegistration>();
        fs = mock<IFileSystem>();
        context = mock<IExtensionContext>();
        onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
        disposables.push(onDidRemoveUris);
        when(mockedVSCodeNamespaces.env.machineId).thenReturn(machineId);
        when(fs.delete(anything())).thenResolve();
        when(context.globalStorageUri).thenReturn(globalStorageUri);
        when(jupyterPickerRegistration.getJupyterServerUri(anything(), anything())).thenResolve(
            resolvableInstance(mock<IJupyterServerUri>())
        );
        let dataInMemento: StorageMRUItem[] | undefined = undefined;
        when(memento.get(mementoKeyForStoringUsedJupyterProviders)).thenReturn(dataInMemento);
        when(memento.get(mementoKeyForStoringUsedJupyterProviders, anything())).thenCall(
            (_, defaultValue) => dataInMemento || defaultValue
        );
        when(memento.update(mementoKeyForStoringUsedJupyterProviders, anything())).thenCall((_, data) => {
            dataInMemento = data;
            return Promise.resolve();
        });

        serverUriStorage = new JupyterServerUriStorage(
            instance(encryptedStorage),
            instance(memento),
            instance(fs),
            instance(context),
            disposables
        );
        onDidRemoveEvent = createEventHandler(serverUriStorage, 'onDidRemove', disposables);
        onDidChangeEvent = createEventHandler(serverUriStorage, 'onDidChange', disposables);
        onDidAddEvent = createEventHandler(serverUriStorage, 'onDidAdd', disposables);
    });
    teardown(() => {
        dispose(disposables);
    });

    test('Migrate data from old storage to new & get all', async () => {
        generateDummyData(2);
        when(fs.exists(anything())).thenResolve(false);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(encryptedStorage.store(anything(), anything(), anything())).thenResolve();
        when(memento.update(Settings.JupyterServerUriList, anything())).thenResolve();
        const itemsInNewStorage: StorageMRUItem[] = [];
        when(fs.writeFile(anything(), anything())).thenCall((_, data) => {
            itemsInNewStorage.push(...JSON.parse(data.toString()));
            when(fs.exists(anything())).thenResolve(true);
            return Promise.resolve();
        });
        when(fs.readFile(anything())).thenCall(() => JSON.stringify(itemsInNewStorage));
        const all = await serverUriStorage.getAll();

        assert.strictEqual(all.length, 2, 'Should have 2 items');
        verify(fs.writeFile(uriEquals(storageFile), JSON.stringify(itemsInNewStorage))).once();
        verify(fs.delete(uriEquals(storageFile))).once();
        verify(memento.update(mementoKeyForStoringUsedJupyterProviders, deepEqual(itemsInNewStorage))).once();
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
    test('Clear when we have some old data', async () => {
        generateDummyData(2);
        when(fs.exists(anything())).thenResolve(false);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(memento.update(Settings.JupyterServerUriList, anything())).thenResolve();
        when(encryptedStorage.store(anything(), anything(), anything())).thenResolve();
        const itemsInNewStorage: StorageMRUItem[] = [];
        when(fs.writeFile(anything(), anything())).thenCall((_, data) => {
            itemsInNewStorage.push(...JSON.parse(data.toString()));
            when(fs.exists(anything())).thenResolve(true);
            return Promise.resolve();
        });
        when(fs.readFile(anything())).thenCall(() => JSON.stringify(itemsInNewStorage));

        when(memento.update(Settings.JupyterServerUriList, anything())).thenResolve();
        when(encryptedStorage.store(anything(), anything(), anything())).thenResolve();

        await serverUriStorage.getAll();
        await serverUriStorage.clear();

        verify(memento.update(Settings.JupyterServerUriList, deepEqual([]))).once();
        verify(
            encryptedStorage.store(
                Settings.JupyterServerRemoteLaunchService,
                Settings.JupyterServerRemoteLaunchUriListKey,
                undefined
            )
        ).once();
        verify(fs.delete(anything())).once();

        // Event should be triggered indicating items have been removed
        await onDidRemoveEvent.assertFired(1);
        const items = onDidRemoveEvent.first;
        assert.strictEqual(items.length, 2);
    });
    test('Clear without any data', async () => {
        when(fs.exists(anything())).thenResolve(true);
        when(memento.get(Settings.JupyterServerUriList)).thenReturn([]);
        when(memento.update(Settings.JupyterServerUriList, anything())).thenResolve();
        when(encryptedStorage.store(anything(), anything(), anything())).thenResolve();
        when(fs.readFile(anything())).thenResolve(JSON.stringify([]));
        when(fs.writeFile(anything(), anything())).thenResolve();

        await serverUriStorage.getAll();
        await serverUriStorage.clear();

        verify(memento.update(Settings.JupyterServerUriList, deepEqual([]))).once();
        verify(
            encryptedStorage.store(
                Settings.JupyterServerRemoteLaunchService,
                Settings.JupyterServerRemoteLaunchUriListKey,
                undefined
            )
        ).once();

        assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
    });
    test('Get All (after migration was done previously)', async () => {
        const itemsInNewStorage = generateDummyData(2, true).slice();
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);

        const all = await serverUriStorage.getAll();
        verify(fs.writeFile(anything(), anything())).never();
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
        const itemsInNewStorage = generateDummyData(2, true).slice();
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });

        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        const all = await serverUriStorage.getAll();

        assert.deepEqual(
            all
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
        generateDummyData(2, true);
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID })
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });

        await serverUriStorage.add(
            { handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID },
            { time: 1234 }
        );
        const all = await serverUriStorage.getAll();

        assert.strictEqual(all.find((a) => a.provider.handle === 'NewHandle1')?.time, 1234, 'Incorrect time');
    });
    test('Add three new entries', async () => {
        const itemsInNewStorage = generateDummyData(2, true).slice();
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9092',
            displayName: 'NewDisplayName2',
            token: 'NewToken2'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId3', handle: 'NewHandle3', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9093',
            displayName: 'NewDisplayName3',
            token: 'NewToken3'
        });
        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        const all = await serverUriStorage.getAll();

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
        const itemsInNewStorage = generateDummyData(2, true).slice();
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9092',
            displayName: 'NewDisplayName2',
            token: 'NewToken2'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId3', handle: 'NewHandle3', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9093',
            displayName: 'NewDisplayName3',
            token: 'NewToken3'
        });
        await Promise.all([
            serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID })
        ]);
        const all = await serverUriStorage.getAll();

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
        const itemsInNewStorage = generateDummyData(2, true).slice();
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9092',
            displayName: 'NewDisplayName2',
            token: 'NewToken2'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId3', handle: 'NewHandle3', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9093',
            displayName: 'NewDisplayName3',
            token: 'NewToken3'
        });
        await Promise.all([
            serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID }),
            serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID })
        ]);
        await serverUriStorage.remove({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID });
        const all = await serverUriStorage.getAll();

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
        const itemsInNewStorage = generateDummyData(2, true).slice();
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9092',
            displayName: 'NewDisplayName2',
            token: 'NewToken2'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId3', handle: 'NewHandle3', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9093',
            displayName: 'NewDisplayName3',
            token: 'NewToken3'
        });
        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.remove({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID });
        const all = await serverUriStorage.getAll();

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
        generateDummyData(2, true);
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9092',
            displayName: 'NewDisplayName2',
            token: 'NewToken2'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId3', handle: 'NewHandle3', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9093',
            displayName: 'NewDisplayName3',
            token: 'NewToken3'
        });
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
        const all = await serverUriStorage.getAll();

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
        generateDummyData(2, true);
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9092',
            displayName: 'NewDisplayName2',
            token: 'NewToken2'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId3', handle: 'NewHandle3', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9093',
            displayName: 'NewDisplayName3',
            token: 'NewToken3'
        });
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
        const all = await serverUriStorage.getAll();

        assert.strictEqual(all.length, 0);
    });
    test('Add three new entries & then update one and remove one', async function () {
        generateDummyData(2, true);
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9092',
            displayName: 'NewDisplayName2',
            token: 'NewToken2'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId3', handle: 'NewHandle3', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9093',
            displayName: 'NewDisplayName3',
            token: 'NewToken3'
        });
        await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3', extensionId: JVSC_EXTENSION_ID });
        const beforeUpdate = await serverUriStorage.getAll();
        const timeOfNewHandle2BeforeUpdate = beforeUpdate.find((item) => item.provider.handle === 'NewHandle2')!;
        assert.ok(timeOfNewHandle2BeforeUpdate);
        await sleep(10);
        await serverUriStorage.update({
            id: 'NewId2',
            handle: 'NewHandle2',
            extensionId: JVSC_EXTENSION_ID
        });
        const afterUpdate = await serverUriStorage.getAll();
        const timeOfNewHandle2AfterUpdate = afterUpdate.find((item) => item.provider.handle === 'NewHandle2')!;
        assert.ok(timeOfNewHandle2BeforeUpdate);
        assert.ok(
            timeOfNewHandle2AfterUpdate.time > timeOfNewHandle2BeforeUpdate.time,
            `time ${timeOfNewHandle2AfterUpdate.time} should be greater than ${timeOfNewHandle2BeforeUpdate.time}`
        );
        await serverUriStorage.remove({ handle: 'NewHandle1', id: 'NewId1', extensionId: JVSC_EXTENSION_ID });
        const all = await serverUriStorage.getAll();

        assert.strictEqual(all.length, 4);
        assert.equal(onDidRemoveEvent.count, 1, 'Event should be fired once');
        assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
        assert.equal(onDidChangeEvent.count, 4, 'Event should be fired 4 times (3 for add, once for add)');
    });
    test('Add three new entries & then remove all', async function () {
        generateDummyData(2, true);
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId1', handle: 'NewHandle1', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9090',
            displayName: 'NewDisplayName1',
            token: 'NewToken1'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId2', handle: 'NewHandle2', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9092',
            displayName: 'NewDisplayName2',
            token: 'NewToken2'
        });
        when(
            jupyterPickerRegistration.getJupyterServerUri(
                deepEqual({ id: 'NewId3', handle: 'NewHandle3', extensionId: JVSC_EXTENSION_ID }),
                true
            )
        ).thenResolve(<IJupyterServerUri>{
            baseUrl: 'http://localhost:9093',
            displayName: 'NewDisplayName3',
            token: 'NewToken3'
        });
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
        const all = await serverUriStorage.getAll();

        assert.strictEqual(all.length, 0);
    });
    test('Add 10 new entries & add 11th, and add more and remove', async function () {
        generateDummyData(8, true);
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        for (let index = 0; index < 20; index++) {
            when(
                jupyterPickerRegistration.getJupyterServerUri(
                    deepEqual({
                        id: `NewId${index}`,
                        handle: `NewHandle${index}`,
                        extensionId: JVSC_EXTENSION_ID
                    }),
                    true
                )
            ).thenResolve(<IJupyterServerUri>{
                baseUrl: `http://localhost:909${index}`,
                displayName: `NewDisplayName${index}`,
                token: `NewToken${index}`
            });
        }

        await serverUriStorage.add({ handle: 'NewHandle9', id: 'NewId9', extensionId: JVSC_EXTENSION_ID });
        await serverUriStorage.add({ handle: 'NewHandle10', id: 'NewId10', extensionId: JVSC_EXTENSION_ID });

        let all = await serverUriStorage.getAll();
        assert.strictEqual(all.length, 10);
        assert.strictEqual(onDidRemoveEvent.count, 0, 'Event should not be fired');
        assert.strictEqual(onDidAddEvent.count, 2, 'Added 2 items');

        // MRU has a max of 10, once we add the 11th, the oldest one should be removed.
        let oldest = all.sort((a, b) => a.time - b.time)[0];
        onDidAddEvent.reset();
        onDidRemoveEvent.reset();
        await serverUriStorage.add({ handle: 'NewHandle11', id: 'NewId11', extensionId: JVSC_EXTENSION_ID });

        all = await serverUriStorage.getAll();
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

        all = await serverUriStorage.getAll();
        assert.strictEqual(all.length, 10);
        assert.strictEqual(onDidRemoveEvent.count, 0, 'One should be automatically removed');

        // Add another new item, then another will get removed automatically.
        oldest = all.sort((a, b) => a.time - b.time)[0];
        onDidAddEvent.reset();
        onDidRemoveEvent.reset();
        await serverUriStorage.add({ handle: 'NewHandle12', id: 'NewId12', extensionId: JVSC_EXTENSION_ID });

        all = await serverUriStorage.getAll();
        assert.strictEqual(all.length, 10);
        assert.strictEqual(onDidRemoveEvent.count, 1, 'One should be automatically removed');
        assert.strictEqual(onDidAddEvent.count, 1, 'Added 1 items');
        assert.strictEqual(onDidRemoveEvent.first[0].handle, 'handle2');
        assert.strictEqual(onDidRemoveEvent.first[0].id, UserJupyterServerPickerProviderId);
        assert.strictEqual(onDidRemoveEvent.first[0].handle, oldest.provider.handle);
        assert.strictEqual(onDidRemoveEvent.first[0].id, oldest.provider.id);
    });
    test('Can get existing items', async function () {
        generateDummyData(8, true);
        when(fs.exists(anything())).thenResolve(true);
        when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
        for (let index = 0; index < 20; index++) {
            when(
                jupyterPickerRegistration.getJupyterServerUri(
                    deepEqual({
                        id: `NewId${index}`,
                        handle: `NewHandle${index}`,
                        extensionId: JVSC_EXTENSION_ID
                    }),
                    true
                )
            ).thenResolve(<IJupyterServerUri>{
                baseUrl: `http://localhost:909${index}`,
                displayName: `NewDisplayName${index}`,
                token: `NewToken${index}`
            });
        }

        // Should exist.
        const time = await (
            await serverUriStorage.getAll()
        ).find(
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
            await (
                await serverUriStorage.getAll()
            ).find(
                (item) =>
                    item.provider.id === UserJupyterServerPickerProviderId &&
                    item.provider.extensionId === JVSC_EXTENSION_ID &&
                    item.provider.handle === 'handle1'
            )
        );

        // Bogus
        const noTime = await (
            await serverUriStorage.getAll()
        ).find(
            (item) =>
                item.provider.id === 'Bogus' &&
                item.provider.extensionId === JVSC_EXTENSION_ID &&
                item.provider.handle === 'handle1'
        );
        assert.isUndefined(noTime);

        // Add and it should exist.
        await serverUriStorage.add({ handle: 'NewHandle11', id: 'NewId11', extensionId: JVSC_EXTENSION_ID });

        const hastTime = await (
            await serverUriStorage.getAll()
        ).find(
            (item) =>
                item.provider.id === 'NewId11' &&
                item.provider.extensionId === JVSC_EXTENSION_ID &&
                item.provider.handle === 'NewHandle11'
        );

        assert.isOk(hastTime);
    });

    function generateDummyData(numberOfEntries: number = 2, generateNewDataAsWell: boolean = false) {
        const data: any[] = [];
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
                index,
                time: Date.now() - 1000 + index
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
        when(memento.get(Settings.JupyterServerUriList)).thenReturn(data);
        when(
            encryptedStorage.retrieve(
                Settings.JupyterServerRemoteLaunchService,
                Settings.JupyterServerRemoteLaunchUriListKey
            )
        ).thenResolve(uris.join(Settings.JupyterServerRemoteLaunchUriSeparator));
        if (generateNewDataAsWell) {
            when(fs.readFile(anything())).thenResolve(JSON.stringify(itemsInNewStorage));
        }
        when(fs.delete(anything())).thenCall(() => {
            itemsInNewStorage.splice(0, itemsInNewStorage.length);
            return Promise.resolve();
        });
        when(fs.writeFile(anything(), anything())).thenCall((_, data) => {
            const itemsWrittenIntoStorage = JSON.parse(data.toString());
            when(fs.readFile(anything())).thenCall(() => JSON.stringify(itemsWrittenIntoStorage));
            when(fs.delete(anything())).thenCall(() => {
                itemsInNewStorage.splice(0, itemsInNewStorage.length);
                itemsWrittenIntoStorage.splice(0, itemsWrittenIntoStorage.length);
                return Promise.resolve();
            });
            return Promise.resolve();
        });

        return itemsInNewStorage;
    }
});
