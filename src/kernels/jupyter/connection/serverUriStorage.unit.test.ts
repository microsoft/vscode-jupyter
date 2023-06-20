// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento, Uri } from 'vscode';
import {
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration
} from '../../../kernels/jupyter/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { Experiments, IDisposable, IExperimentService, IExtensionContext } from '../../../platform/common/types';
import { JupyterServerUriStorage, StorageMRUItem } from './serverUriStorage';
import { IEncryptedStorage } from '../../../platform/common/application/types';
import { IFileSystem } from '../../../platform/common/platform/types';
import { IJupyterServerUri } from '../../../api';
import { Settings } from '../../../platform/common/constants';
import { TestEventHandler, createEventHandler } from '../../../test/common';
import { computeServerId, generateUriFromRemoteProvider } from '../jupyterUtils';
import { resolvableInstance, uriEquals } from '../../../test/datascience/helpers';
import { sleep } from '../../../test/core';

suite('Server Uri Storage', async () => {
    ['New Storage Format', 'Old Storage Format'].forEach((storageFormat) => {
        let isNewStorageFormat = storageFormat === 'New Storage Format';
        suite(storageFormat, () => {
            let serverUriStorage: IJupyterServerUriStorage;
            let memento: Memento;
            let onDidRemoveUris: EventEmitter<IJupyterServerUriEntry[]>;
            const disposables: IDisposable[] = [];
            let encryptedStorage: IEncryptedStorage;
            let jupyterPickerRegistration: IJupyterUriProviderRegistration;
            let experiments: IExperimentService;
            let fs: IFileSystem;
            let context: IExtensionContext;
            let globalStorageUri = Uri.file('GlobalStorage');
            let storageFile = Uri.joinPath(globalStorageUri, 'remoteServersMRUList.json');
            let onDidRemoveEvent: TestEventHandler<IJupyterServerUriEntry[]>;
            let onDidChangeEvent: TestEventHandler<void>;
            let onDidAddEvent: TestEventHandler<IJupyterServerUriEntry>;

            setup(() => {
                memento = mock<Memento>();
                encryptedStorage = mock<IEncryptedStorage>();
                jupyterPickerRegistration = mock<IJupyterUriProviderRegistration>();
                experiments = mock<IExperimentService>();
                fs = mock<IFileSystem>();
                context = mock<IExtensionContext>();
                onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
                disposables.push(onDidRemoveUris);
                when(context.globalStorageUri).thenReturn(globalStorageUri);
                when(experiments.inExperiment(Experiments.NewRemoteUriStorage)).thenReturn(isNewStorageFormat);
                when(jupyterPickerRegistration.getJupyterServerUri(anything(), anything())).thenResolve(
                    resolvableInstance(mock<IJupyterServerUri>())
                );

                serverUriStorage = new JupyterServerUriStorage(
                    instance(encryptedStorage),
                    instance(memento),
                    instance(jupyterPickerRegistration),
                    instance(experiments),
                    instance(fs),
                    instance(context),
                    disposables
                );
                onDidRemoveEvent = createEventHandler(serverUriStorage, 'onDidRemove', disposables);
                onDidChangeEvent = createEventHandler(serverUriStorage, 'onDidChange', disposables);
                onDidAddEvent = createEventHandler(serverUriStorage, 'onDidAdd', disposables);
            });
            teardown(() => {
                disposeAllDisposables(disposables);
            });

            test('Migrate data from old storage to new & get all', async () => {
                generateDummyData(2);
                when(fs.exists(anything())).thenResolve(false);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(memento.update(Settings.JupyterServerUriList, anything())).thenResolve();
                when(encryptedStorage.store(anything(), anything(), anything())).thenResolve();
                const itemsInNewStorage: StorageMRUItem[] = [];
                when(fs.writeFile(anything(), anything())).thenCall((_, data) => {
                    itemsInNewStorage.push(...JSON.parse(data.toString()));
                    return Promise.resolve();
                });
                when(fs.readFile(anything())).thenCall(() => JSON.stringify(itemsInNewStorage));

                const all = await serverUriStorage.getAll();

                assert.strictEqual(all.length, 2, 'Should have 2 items');
                verify(fs.writeFile(uriEquals(storageFile), JSON.stringify(itemsInNewStorage))).once();
                assert.deepEqual(
                    all
                        .map((a) => {
                            return {
                                time: a.time,
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.provider.id, a.provider.handle)
                            };
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
                    itemsInNewStorage
                        .map((a) => {
                            return {
                                time: a.time,
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.serverHandle.id, a.serverHandle.handle)
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
                verify(fs.writeFile(anything(), JSON.stringify([]))).once();

                // Event should be triggered indicating items have been removed
                await onDidRemoveEvent.assertFired(1);
                const items = onDidRemoveEvent.first as IJupyterServerUriEntry[];
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

                if (isNewStorageFormat) {
                    assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
                } else {
                    await onDidRemoveEvent.assertFired(1);
                    const items = onDidRemoveEvent.first as IJupyterServerUriEntry[];
                    assert.strictEqual(items.length, 0);
                }
            });
            test('Get All (after migration was done previously)', async () => {
                const itemsInNewStorage = generateDummyData(2, true);
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
                                uri: generateUriFromRemoteProvider(a.provider.id, a.provider.handle)
                            };
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
                    itemsInNewStorage
                        .map((a) => {
                            return {
                                time: a.time,
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.serverHandle.id, a.serverHandle.handle)
                            };
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
                );
            });

            test('Add new entry', async () => {
                const itemsInNewStorage = generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });

                await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' });
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).once();
                assert.deepEqual(
                    all
                        .sort((a, b) => a.time - b.time)
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.provider.id, a.provider.handle)
                            };
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
                    itemsInNewStorage
                        .sort((a, b) => a.time - b.time)
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.serverHandle.id, a.serverHandle.handle)
                            };
                        })
                        .concat({
                            displayName: 'NewDisplayName1',
                            uri: generateUriFromRemoteProvider('NewId1', 'NewHandle1')
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
                );

                assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
                assert.equal(onDidAddEvent.count, 1, 'Event should be fired once');
                assert.equal(onDidChangeEvent.count, 1, 'Event should be fired once');
            });
            test('Add three new entries', async () => {
                const itemsInNewStorage = generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId2', 'NewHandle2')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9092',
                    displayName: 'NewDisplayName2',
                    token: 'NewToken2'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId3', 'NewHandle3')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9093',
                    displayName: 'NewDisplayName3',
                    token: 'NewToken3'
                });
                await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' });
                await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2' });
                await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3' });
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).atLeast(1);
                assert.deepEqual(
                    all
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.provider.id, a.provider.handle)
                            };
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
                    itemsInNewStorage
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.serverHandle.id, a.serverHandle.handle)
                            };
                        })
                        .concat({
                            displayName: 'NewDisplayName1',
                            uri: generateUriFromRemoteProvider('NewId1', 'NewHandle1')
                        })
                        .concat({
                            displayName: 'NewDisplayName2',
                            uri: generateUriFromRemoteProvider('NewId2', 'NewHandle2')
                        })
                        .concat({
                            displayName: 'NewDisplayName3',
                            uri: generateUriFromRemoteProvider('NewId3', 'NewHandle3')
                        })
                        .sort((a, b) => a.displayName.localeCompare(b.displayName))
                );

                assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
                assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
                assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 3 times');
            });
            test('Add three new entries (without waiting)', async function () {
                if (!isNewStorageFormat) {
                    return this.skip();
                }
                const itemsInNewStorage = generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId2', 'NewHandle2')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9092',
                    displayName: 'NewDisplayName2',
                    token: 'NewToken2'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId3', 'NewHandle3')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9093',
                    displayName: 'NewDisplayName3',
                    token: 'NewToken3'
                });
                await Promise.all([
                    serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' }),
                    serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2' }),
                    serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3' })
                ]);
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).atLeast(1);
                assert.deepEqual(
                    all
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.provider.id, a.provider.handle)
                            };
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
                    itemsInNewStorage
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.serverHandle.id, a.serverHandle.handle)
                            };
                        })
                        .concat({
                            displayName: 'NewDisplayName1',
                            uri: generateUriFromRemoteProvider('NewId1', 'NewHandle1')
                        })
                        .concat({
                            displayName: 'NewDisplayName2',
                            uri: generateUriFromRemoteProvider('NewId2', 'NewHandle2')
                        })
                        .concat({
                            displayName: 'NewDisplayName3',
                            uri: generateUriFromRemoteProvider('NewId3', 'NewHandle3')
                        })
                        .sort((a, b) => a.displayName.localeCompare(b.displayName))
                );

                assert.equal(onDidRemoveEvent.count, 0, 'Event should not be fired');
                assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
                assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 3 times');
            });
            test('Add three new entries (without waiting) & then remove one', async function () {
                if (!isNewStorageFormat) {
                    return this.skip();
                }
                const itemsInNewStorage = generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId2', 'NewHandle2')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9092',
                    displayName: 'NewDisplayName2',
                    token: 'NewToken2'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId3', 'NewHandle3')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9093',
                    displayName: 'NewDisplayName3',
                    token: 'NewToken3'
                });
                await Promise.all([
                    serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' }),
                    serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2' }),
                    serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3' })
                ]);
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId2', 'NewHandle2'))
                );
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).atLeast(1);
                assert.deepEqual(
                    all
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.provider.id, a.provider.handle)
                            };
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
                    itemsInNewStorage
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.serverHandle.id, a.serverHandle.handle)
                            };
                        })
                        .concat({
                            displayName: 'NewDisplayName1',
                            uri: generateUriFromRemoteProvider('NewId1', 'NewHandle1')
                        })
                        .concat({
                            displayName: 'NewDisplayName3',
                            uri: generateUriFromRemoteProvider('NewId3', 'NewHandle3')
                        })
                        .sort((a, b) => a.displayName.localeCompare(b.displayName))
                );

                assert.equal(onDidRemoveEvent.count, 1, 'Event should be fired once');
                assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
                assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 4 times (3 for add, one for remove)');
            });
            test('Add three new entries & then remove one', async function () {
                if (!isNewStorageFormat) {
                    return this.skip();
                }
                const itemsInNewStorage = generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId2', 'NewHandle2')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9092',
                    displayName: 'NewDisplayName2',
                    token: 'NewToken2'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId3', 'NewHandle3')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9093',
                    displayName: 'NewDisplayName3',
                    token: 'NewToken3'
                });
                await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' });
                await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2' });
                await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3' });
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId2', 'NewHandle2'))
                );
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).atLeast(1);
                assert.deepEqual(
                    all
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.provider.id, a.provider.handle)
                            };
                        })
                        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')),
                    itemsInNewStorage
                        .map((a) => {
                            return {
                                displayName: a.displayName,
                                uri: generateUriFromRemoteProvider(a.serverHandle.id, a.serverHandle.handle)
                            };
                        })
                        .concat({
                            displayName: 'NewDisplayName1',
                            uri: generateUriFromRemoteProvider('NewId1', 'NewHandle1')
                        })
                        .concat({
                            displayName: 'NewDisplayName3',
                            uri: generateUriFromRemoteProvider('NewId3', 'NewHandle3')
                        })
                        .sort((a, b) => a.displayName.localeCompare(b.displayName))
                );

                assert.equal(onDidRemoveEvent.count, 1, 'Event should be fired once');
                assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
                assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 4 times (3 for add, one for remove)');
            });
            test('Add three new entries (without waiting) & then remove all', async function () {
                if (!isNewStorageFormat) {
                    return this.skip();
                }
                generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId2', 'NewHandle2')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9092',
                    displayName: 'NewDisplayName2',
                    token: 'NewToken2'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId3', 'NewHandle3')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9093',
                    displayName: 'NewDisplayName3',
                    token: 'NewToken3'
                });
                await Promise.all([
                    serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' }),
                    serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2' }),
                    serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3' })
                ]);
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId1', 'NewHandle1'))
                );
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId2', 'NewHandle2'))
                );
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId3', 'NewHandle3'))
                );
                await serverUriStorage.remove(await computeServerId(generateUriFromRemoteProvider('1', 'handle1')));
                await serverUriStorage.remove(await computeServerId(generateUriFromRemoteProvider('1', 'handle2')));
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).atLeast(1);
                assert.strictEqual(all.length, 0);
                assert.equal(onDidRemoveEvent.count, 5, 'Event should be fired 5 times');
                assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
                assert.equal(onDidChangeEvent.count, 3, 'Event should be fired 4 times (3 for add, one for remove)');
            });
            test('Add three new entries (without waiting) & then remove all (without waiting)', async function () {
                if (!isNewStorageFormat) {
                    return this.skip();
                }
                generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId2', 'NewHandle2')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9092',
                    displayName: 'NewDisplayName2',
                    token: 'NewToken2'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId3', 'NewHandle3')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9093',
                    displayName: 'NewDisplayName3',
                    token: 'NewToken3'
                });
                await Promise.all([
                    serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' }),
                    serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2' }),
                    serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3' })
                ]);
                await Promise.all([
                    serverUriStorage.remove(
                        await computeServerId(generateUriFromRemoteProvider('NewId1', 'NewHandle1'))
                    ),
                    serverUriStorage.remove(
                        await computeServerId(generateUriFromRemoteProvider('NewId2', 'NewHandle2'))
                    ),
                    serverUriStorage.remove(
                        await computeServerId(generateUriFromRemoteProvider('NewId3', 'NewHandle3'))
                    ),
                    serverUriStorage.remove(await computeServerId(generateUriFromRemoteProvider('1', 'handle1'))),
                    serverUriStorage.remove(await computeServerId(generateUriFromRemoteProvider('1', 'handle2')))
                ]);
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).atLeast(1);
                assert.strictEqual(all.length, 0);
            });
            test('Add three new entries & then update one and remove one', async function () {
                generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId2', 'NewHandle2')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9092',
                    displayName: 'NewDisplayName2',
                    token: 'NewToken2'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId3', 'NewHandle3')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9093',
                    displayName: 'NewDisplayName3',
                    token: 'NewToken3'
                });
                await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' });
                await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2' });
                await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3' });
                const beforeUpdate = await serverUriStorage.getAll();
                const timeOfNewHandle2BeforeUpdate = beforeUpdate.find(
                    (item) => item.provider.handle === 'NewHandle2'
                )!;
                assert.ok(timeOfNewHandle2BeforeUpdate);
                await sleep(10);
                await serverUriStorage.update(
                    await computeServerId(generateUriFromRemoteProvider('NewId2', 'NewHandle2'))
                );
                const afterUpdate = await serverUriStorage.getAll();
                const timeOfNewHandle2AfterUpdate = afterUpdate.find((item) => item.provider.handle === 'NewHandle2')!;
                assert.ok(timeOfNewHandle2BeforeUpdate);
                assert.ok(
                    timeOfNewHandle2AfterUpdate.time > timeOfNewHandle2BeforeUpdate.time,
                    `time ${timeOfNewHandle2AfterUpdate.time} should be greater than ${timeOfNewHandle2BeforeUpdate.time}`
                );
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId1', 'NewHandle1'))
                );
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).atLeast(1);
                assert.strictEqual(all.length, 4);
                assert.equal(onDidRemoveEvent.count, 1, 'Event should be fired once');
                if (isNewStorageFormat) {
                    assert.equal(onDidAddEvent.count, 3, 'Event should be fired 3 times');
                } else {
                    assert.equal(onDidAddEvent.count, 4, 'Event should be fired 4 times (3 adds and one update)');
                }
                assert.equal(onDidChangeEvent.count, 4, 'Event should be fired 4 times (3 for add, once for add)');
            });
            test('Add three new entries & then remove all', async function () {
                generateDummyData(2, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                when(jupyterPickerRegistration.getJupyterServerUri('NewId1', 'NewHandle1')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9090',
                    displayName: 'NewDisplayName1',
                    token: 'NewToken1'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId2', 'NewHandle2')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9092',
                    displayName: 'NewDisplayName2',
                    token: 'NewToken2'
                });
                when(jupyterPickerRegistration.getJupyterServerUri('NewId3', 'NewHandle3')).thenResolve(<
                    IJupyterServerUri
                >{
                    baseUrl: 'http://localhost:9093',
                    displayName: 'NewDisplayName3',
                    token: 'NewToken3'
                });
                await serverUriStorage.add({ handle: 'NewHandle1', id: 'NewId1' });
                await serverUriStorage.add({ handle: 'NewHandle2', id: 'NewId2' });
                await serverUriStorage.add({ handle: 'NewHandle3', id: 'NewId3' });
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId1', 'NewHandle1'))
                );
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId2', 'NewHandle2'))
                );
                await serverUriStorage.remove(
                    await computeServerId(generateUriFromRemoteProvider('NewId3', 'NewHandle3'))
                );
                await serverUriStorage.remove(await computeServerId(generateUriFromRemoteProvider('1', 'handle1')));
                await serverUriStorage.remove(await computeServerId(generateUriFromRemoteProvider('1', 'handle2')));
                const all = await serverUriStorage.getAll();

                verify(fs.writeFile(anything(), anything())).atLeast(1);
                assert.strictEqual(all.length, 0);
            });
            test('Add 10 new entries & add 11th, and add mroe and remove', async function () {
                generateDummyData(8, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                for (let index = 0; index < 20; index++) {
                    when(
                        jupyterPickerRegistration.getJupyterServerUri(`NewId${index}`, `NewHandle${index}`)
                    ).thenResolve(<IJupyterServerUri>{
                        baseUrl: `http://localhost:909${index}`,
                        displayName: `NewDisplayName${index}`,
                        token: `NewToken${index}`
                    });
                }

                await serverUriStorage.add({ handle: 'NewHandle9', id: 'NewId9' });
                await serverUriStorage.add({ handle: 'NewHandle10', id: 'NewId10' });

                let all = await serverUriStorage.getAll();
                assert.strictEqual(all.length, 10);
                assert.strictEqual(onDidRemoveEvent.count, 0, 'Event should not be fired');
                assert.strictEqual(onDidAddEvent.count, 2, 'Added 2 items');

                // MRU has a max of 10, once we add the 11th, the oldest one should be removed.
                let oldest = all.sort((a, b) => a.time - b.time)[0];
                onDidAddEvent.reset();
                onDidRemoveEvent.reset();
                await serverUriStorage.add({ handle: 'NewHandle11', id: 'NewId11' });

                all = await serverUriStorage.getAll();
                assert.strictEqual(all.length, 10);
                assert.strictEqual(onDidRemoveEvent.count, 1, 'One should be automatically removed');
                assert.strictEqual(onDidAddEvent.count, 1, 'Added 1 items');
                assert.strictEqual(onDidRemoveEvent.first[0].provider.handle, 'handle1');
                assert.strictEqual(onDidRemoveEvent.first[0].provider.id, '1');
                assert.strictEqual(onDidRemoveEvent.first[0].provider.handle, oldest.provider.handle);
                assert.strictEqual(onDidRemoveEvent.first[0].provider.id, oldest.provider.id);

                // Add (or update with the same item) does not remove any items.
                onDidAddEvent.reset();
                onDidRemoveEvent.reset();
                await serverUriStorage.add({ handle: 'NewHandle11', id: 'NewId11' });
                await serverUriStorage.update(
                    await computeServerId(generateUriFromRemoteProvider('NewId11', 'NewHandle11'))
                );

                all = await serverUriStorage.getAll();
                assert.strictEqual(all.length, 10);
                assert.strictEqual(onDidRemoveEvent.count, 0, 'One should be automatically removed');

                // Add another new item, then another will get removed automatically.
                oldest = all.sort((a, b) => a.time - b.time)[0];
                onDidAddEvent.reset();
                onDidRemoveEvent.reset();
                await serverUriStorage.add({ handle: 'NewHandle12', id: 'NewId12' });

                all = await serverUriStorage.getAll();
                assert.strictEqual(all.length, 10);
                assert.strictEqual(onDidRemoveEvent.count, 1, 'One should be automatically removed');
                assert.strictEqual(onDidAddEvent.count, 1, 'Added 1 items');
                assert.strictEqual(onDidRemoveEvent.first[0].provider.handle, 'handle2');
                assert.strictEqual(onDidRemoveEvent.first[0].provider.id, '1');
                assert.strictEqual(onDidRemoveEvent.first[0].provider.handle, oldest.provider.handle);
                assert.strictEqual(onDidRemoveEvent.first[0].provider.id, oldest.provider.id);
            });
            test('Can get existing items', async function () {
                generateDummyData(8, true);
                when(fs.exists(anything())).thenResolve(true);
                when(fs.exists(uriEquals(globalStorageUri))).thenResolve(true);
                for (let index = 0; index < 20; index++) {
                    when(
                        jupyterPickerRegistration.getJupyterServerUri(`NewId${index}`, `NewHandle${index}`)
                    ).thenResolve(<IJupyterServerUri>{
                        baseUrl: `http://localhost:909${index}`,
                        displayName: `NewDisplayName${index}`,
                        token: `NewToken${index}`
                    });
                }

                // Should exist.
                const server1 = await serverUriStorage.get(
                    await computeServerId(generateUriFromRemoteProvider('1', 'handle1'))
                );

                assert.strictEqual(server1?.provider.id, '1');
                assert.strictEqual(server1?.provider.handle, 'handle1');

                // Remove this.
                await serverUriStorage.remove(await computeServerId(generateUriFromRemoteProvider('1', 'handle1')));

                assert.isUndefined(
                    await serverUriStorage.get(await computeServerId(generateUriFromRemoteProvider('1', 'handle1')))
                );

                // Bogus
                const serverBogus = await serverUriStorage.get(
                    await computeServerId(generateUriFromRemoteProvider('Bogus', 'handle1'))
                );

                assert.isUndefined(serverBogus);

                // Add and it should exist.
                await serverUriStorage.add({ handle: 'NewHandle11', id: 'NewId11' });

                const newServer = await serverUriStorage.get(
                    await computeServerId(generateUriFromRemoteProvider('NewId11', 'NewHandle11'))
                );

                assert.strictEqual(newServer?.provider.id, 'NewId11');
                assert.strictEqual(newServer?.provider.handle, 'NewHandle11');
            });

            function generateDummyData(numberOfEntries: number = 2, generateNewDataAsWell: boolean = false) {
                const data: any[] = [];
                const uris: string[] = [];
                const itemsInNewStorage: StorageMRUItem[] = [];
                for (let index = 0; index < numberOfEntries; index += 1) {
                    const uri = generateUriFromRemoteProvider('1', `handle${index + 1}`);
                    const displayName = `displayName${index}`;
                    uris.push(`${uri}${Settings.JupyterServerRemoteLaunchNameSeparator}${displayName}`);
                    data.push({
                        index,
                        time: index
                    });
                    itemsInNewStorage.push({
                        displayName,
                        serverHandle: { id: '1', handle: `handle${index + 1}` },
                        time: index
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

                when(fs.writeFile(anything(), anything())).thenCall((_, data) => {
                    const itemsWrittenIntoStorage = JSON.parse(data.toString());
                    when(fs.readFile(anything())).thenCall(() => JSON.stringify(itemsWrittenIntoStorage));
                    return Promise.resolve();
                });

                return itemsInNewStorage;
            }
        });
    });
});
