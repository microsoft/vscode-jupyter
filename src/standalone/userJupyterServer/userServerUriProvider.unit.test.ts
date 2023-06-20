// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import {
    IJupyterRequestCreator,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration
} from '../../kernels/jupyter/types';
import {
    Experiments,
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IExperimentService
} from '../../platform/common/types';
import { IMultiStepInputFactory } from '../../platform/common/utils/multiStepInput';
import {
    NewStorage,
    OldStorage,
    UserJupyterServerUriListKey,
    UserJupyterServerUriListKeyV2,
    UserJupyterServerUriListMementoKey,
    UserJupyterServerUrlProvider
} from './userServerUrlProvider';
import { Disposable, Memento } from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import {
    IClipboard,
    IApplicationShell,
    IEncryptedStorage,
    ICommandManager
} from '../../platform/common/application/types';
import { noop, sleep } from '../../test/core';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { Settings } from '../../platform/common/constants';
import { assert } from 'chai';
import { generateUriFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { DataScience } from '../../platform/common/utils/localize';
import { JupyterPasswordConnect } from './jupyterPasswordConnect';

/* eslint-disable @typescript-eslint/no-explicit-any, ,  */
suite.only('User Uri Provider', () => {
    suite('Migration of Existing Uri', () => {
        ['Old Storage Format', 'New Storage Format'].forEach((storageFormat) => {
            suite(storageFormat, () => {
                const isNewStorageFormat = storageFormat === 'New Storage Format';
                let provider: UserJupyterServerUrlProvider;
                let clipboard: IClipboard;
                let uriProviderRegistration: IJupyterUriProviderRegistration;
                let applicationShell: IApplicationShell;
                let configService: IConfigurationService;
                let jupyterConnection: JupyterConnection;
                let encryptedStorage: IEncryptedStorage;
                let serverUriStorage: IJupyterServerUriStorage;
                let globalMemento: Memento;
                const disposables: IDisposable[] = [];
                let multiStepFactory: IMultiStepInputFactory;
                let asyncDisposables: IAsyncDisposable[] = [];
                let asyncDisposableRegistry: IAsyncDisposableRegistry = {
                    dispose: async function () {
                        await Promise.all(asyncDisposables.map((d) => d.dispose().catch(noop)));
                        asyncDisposables = [];
                    },
                    push: function (disposable: IAsyncDisposable | IDisposable) {
                        asyncDisposables.push(disposable as any);
                    }
                };
                let commands: ICommandManager;
                let requestCreator: IJupyterRequestCreator;
                let experiments: IExperimentService;

                setup(() => {
                    clipboard = mock<IClipboard>();
                    uriProviderRegistration = mock<IJupyterUriProviderRegistration>();
                    applicationShell = mock<IApplicationShell>();
                    configService = mock<IConfigurationService>();
                    jupyterConnection = mock<JupyterConnection>();
                    encryptedStorage = mock<IEncryptedStorage>();
                    serverUriStorage = mock<IJupyterServerUriStorage>();
                    globalMemento = mock<Memento>();
                    multiStepFactory = mock<IMultiStepInputFactory>();
                    commands = mock<ICommandManager>();
                    requestCreator = mock<IJupyterRequestCreator>();
                    experiments = mock<IExperimentService>();
                    when(experiments.inExperiment(Experiments.NewRemoteUriStorage)).thenReturn(isNewStorageFormat);
                    sinon.stub(OldStorage.prototype, 'clear').resolves();

                    provider = new UserJupyterServerUrlProvider(
                        instance(clipboard),
                        instance(uriProviderRegistration),
                        instance(applicationShell),
                        instance(configService),
                        instance(jupyterConnection),
                        false,
                        instance(encryptedStorage),
                        instance(serverUriStorage),
                        instance(globalMemento),
                        disposables,
                        instance(multiStepFactory),
                        asyncDisposableRegistry,
                        instance(commands),
                        undefined,
                        instance(requestCreator),
                        instance(experiments)
                    );
                });
                teardown(async () => {
                    sinon.restore();
                    disposeAllDisposables(disposables);
                    await asyncDisposableRegistry.dispose();
                });

                async function testMigration(slowStorageAccess = false) {
                    const oldUrls: string[] = [
                        `http://localhost:8888${Settings.JupyterServerRemoteLaunchNameSeparator}Hello World`,
                        `http://localhost:9999${Settings.JupyterServerRemoteLaunchNameSeparator}Foo Bar`,
                        `${generateUriFromRemoteProvider('1', '2')}${
                            Settings.JupyterServerRemoteLaunchNameSeparator
                        }Remote Provider`
                    ];
                    when(
                        encryptedStorage.retrieve(
                            Settings.JupyterServerRemoteLaunchService,
                            Settings.JupyterServerRemoteLaunchUriListKey
                        )
                    ).thenResolve(oldUrls.join(Settings.JupyterServerRemoteLaunchUriSeparator));
                    if (slowStorageAccess) {
                        sinon.stub(OldStorage.prototype, 'getServers').callsFake(() => sleep(10).then(() => []));
                        sinon.stub(NewStorage.prototype, 'getServers').callsFake(() => sleep(10).then(() => []));
                        sinon.stub(OldStorage.prototype, 'add').callsFake(() => sleep(10));
                        sinon.stub(NewStorage.prototype, 'clear').callsFake(() => sleep(10));
                        sinon.stub(NewStorage.prototype, 'add').callsFake(() => sleep(10));
                        sinon.stub(NewStorage.prototype, 'migrate').callsFake(() => sleep(10));
                        sinon.stub(NewStorage.prototype, 'migrationDone').get(() => sleep(10));
                    } else {
                        sinon.stub(OldStorage.prototype, 'getServers').resolves([]);
                        sinon.stub(NewStorage.prototype, 'getServers').resolves([]);
                        sinon.stub(OldStorage.prototype, 'add').resolves();
                        sinon.stub(NewStorage.prototype, 'clear').resolves();
                        sinon.stub(NewStorage.prototype, 'add').resolves();
                        sinon.stub(NewStorage.prototype, 'migrate').resolves();
                        sinon.stub(NewStorage.prototype, 'migrationDone').get(() => Promise.resolve());
                    }

                    provider.activate();
                    let handles = await provider.getHandles();

                    if (slowStorageAccess) {
                        try {
                            assert.strictEqual(handles.length, 2);
                        } catch {
                            // Wait for a while and try again
                            await sleep(100);
                            handles = await provider.getHandles();
                            assert.strictEqual(handles.length, 2);
                        }
                    } else {
                        assert.strictEqual(handles.length, 2);
                    }

                    const servers = await Promise.all(handles.map((h) => provider.getServerUri(h)));
                    assert.strictEqual(servers.length, 2);
                    servers.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
                    assert.deepEqual(servers, [
                        {
                            baseUrl: 'http://localhost:8888/',
                            token: '',
                            displayName: 'Hello World'
                        },
                        {
                            baseUrl: 'http://localhost:9999/',
                            token: '',
                            displayName: 'Foo Bar'
                        }
                    ]);
                }
                test('Migrate Old Urls (slow storage access)', async () => testMigration(true));
                test('Migrate Old Urls (fast storage access)', async () => testMigration(false));
            });
        });
    });
    suite.only('Password Storage', () => {
        // ['New Storage Format'].forEach((storageFormat) => {
        // ['Old Storage Format'].forEach((storageFormat) => {
        ['Old Storage Format', 'New Storage Format'].forEach((storageFormat) => {
            suite(storageFormat, () => {
                const isNewStorageFormat = storageFormat === 'New Storage Format';
                let provider: UserJupyterServerUrlProvider;
                let clipboard: IClipboard;
                let uriProviderRegistration: IJupyterUriProviderRegistration;
                let applicationShell: IApplicationShell;
                let configService: IConfigurationService;
                let jupyterConnection: JupyterConnection;
                let encryptedStorage: IEncryptedStorage;
                let serverUriStorage: IJupyterServerUriStorage;
                let globalMemento: Memento;
                const disposables: IDisposable[] = [];
                let multiStepFactory: IMultiStepInputFactory;
                let asyncDisposables: IAsyncDisposable[] = [];
                let asyncDisposableRegistry: IAsyncDisposableRegistry = {
                    dispose: async function () {
                        await Promise.all(asyncDisposables.map((d) => d.dispose().catch(noop)));
                        asyncDisposables = [];
                    },
                    push: function (disposable: IAsyncDisposable | IDisposable) {
                        asyncDisposables.push(disposable as any);
                    }
                };
                let commands: ICommandManager;
                let requestCreator: IJupyterRequestCreator;
                let experiments: IExperimentService;
                let inputBox: InputBox;

                setup(() => {
                    inputBox = {
                        show: noop,
                        onDidAccept: noop as any,
                        onDidHide: noop as any,
                        hide: noop,
                        dispose: noop as any,
                        onDidChangeValue: noop as any,
                        onDidTriggerButton: noop as any,
                        valueSelection: undefined,
                        totalSteps: undefined,
                        validationMessage: '',
                        busy: false,
                        buttons: [],
                        enabled: true,
                        ignoreFocusOut: false,
                        password: false,
                        step: undefined,
                        title: '',
                        value: '',
                        prompt: '',
                        placeholder: ''
                    };
                    sinon.stub(inputBox, 'show').callsFake(noop);
                    sinon.stub(inputBox, 'onDidAccept').callsFake((cb) => {
                        (cb as Function)();
                        return new Disposable(noop);
                    });
                    sinon.stub(inputBox, 'onDidHide').callsFake(() => new Disposable(noop));

                    clipboard = mock<IClipboard>();
                    uriProviderRegistration = mock<IJupyterUriProviderRegistration>();
                    applicationShell = mock<IApplicationShell>();
                    configService = mock<IConfigurationService>();
                    jupyterConnection = mock<JupyterConnection>();
                    encryptedStorage = mock<IEncryptedStorage>();
                    serverUriStorage = mock<IJupyterServerUriStorage>();
                    globalMemento = mock<Memento>();
                    multiStepFactory = mock<IMultiStepInputFactory>();
                    commands = mock<ICommandManager>();
                    requestCreator = mock<IJupyterRequestCreator>();
                    experiments = mock<IExperimentService>();
                    when(applicationShell.createInputBox()).thenReturn(inputBox);
                    when(jupyterConnection.validateRemoteUri(anything())).thenResolve();
                    when(experiments.inExperiment(Experiments.NewRemoteUriStorage)).thenReturn(isNewStorageFormat);
                    when(globalMemento.get(UserJupyterServerUriListKey)).thenReturn([]);
                    when(globalMemento.update(UserJupyterServerUriListKey, anything())).thenCall((_, v) => {
                        when(globalMemento.get(UserJupyterServerUriListKey)).thenReturn(v);
                        return Promise.resolve();
                    });
                    when(globalMemento.update(UserJupyterServerUriListMementoKey, anything())).thenCall((_, v) => {
                        when(globalMemento.get(UserJupyterServerUriListMementoKey)).thenReturn(v);
                        return Promise.resolve();
                    });
                    when(
                        encryptedStorage.retrieve(
                            Settings.JupyterServerRemoteLaunchService,
                            UserJupyterServerUriListKey
                        )
                    ).thenResolve();
                    when(
                        encryptedStorage.store(
                            Settings.JupyterServerRemoteLaunchService,
                            UserJupyterServerUriListKey,
                            anything()
                        )
                    ).thenCall((_, __, v) => {
                        when(
                            encryptedStorage.retrieve(
                                Settings.JupyterServerRemoteLaunchService,
                                UserJupyterServerUriListKey
                            )
                        ).thenReturn(v);
                        return Promise.resolve();
                    });

                    when(
                        encryptedStorage.retrieve(
                            Settings.JupyterServerRemoteLaunchService,
                            UserJupyterServerUriListKeyV2
                        )
                    ).thenResolve();
                    when(
                        encryptedStorage.store(
                            Settings.JupyterServerRemoteLaunchService,
                            UserJupyterServerUriListKeyV2,
                            anything()
                        )
                    ).thenCall((_, __, v) => {
                        when(
                            encryptedStorage.retrieve(
                                Settings.JupyterServerRemoteLaunchService,
                                UserJupyterServerUriListKeyV2
                            )
                        ).thenReturn(v);
                        return Promise.resolve();
                    });
                    sinon
                        .stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo')
                        .resolves({ requiresPassword: false });
                    provider = new UserJupyterServerUrlProvider(
                        instance(clipboard),
                        instance(uriProviderRegistration),
                        instance(applicationShell),
                        instance(configService),
                        instance(jupyterConnection),
                        false,
                        instance(encryptedStorage),
                        instance(serverUriStorage),
                        instance(globalMemento),
                        disposables,
                        instance(multiStepFactory),
                        asyncDisposableRegistry,
                        instance(commands),
                        undefined,
                        instance(requestCreator),
                        instance(experiments)
                    );
                });
                teardown(async () => {
                    sinon.restore();
                    disposeAllDisposables(disposables);
                    await asyncDisposableRegistry.dispose();
                });

                async function testMigration() {
                    const oldUrls: string[] = [
                        `http://localhost:8888${Settings.JupyterServerRemoteLaunchNameSeparator}Hello World`,
                        `http://localhost:9999${Settings.JupyterServerRemoteLaunchNameSeparator}Foo Bar`,
                        `${generateUriFromRemoteProvider('1', '2')}${
                            Settings.JupyterServerRemoteLaunchNameSeparator
                        }Remote Provider`
                    ];
                    when(
                        encryptedStorage.retrieve(
                            Settings.JupyterServerRemoteLaunchService,
                            Settings.JupyterServerRemoteLaunchUriListKey
                        )
                    ).thenResolve(oldUrls.join(Settings.JupyterServerRemoteLaunchUriSeparator));

                    provider.activate();
                    let handles = await provider.getHandles();

                    try {
                        assert.strictEqual(handles.length, 2);
                    } catch {
                        // Wait for a while and try again
                        await sleep(100);
                        handles = await provider.getHandles();
                        assert.strictEqual(handles.length, 2);
                    }

                    const servers = await Promise.all(handles.map((h) => provider.getServerUri(h)));
                    assert.strictEqual(servers.length, 2);
                    servers.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
                    assert.deepEqual(servers, [
                        {
                            baseUrl: 'http://localhost:8888/',
                            token: '',
                            displayName: 'Hello World'
                        },
                        {
                            baseUrl: 'http://localhost:9999/',
                            token: '',
                            displayName: 'Foo Bar'
                        }
                    ]);
                }
                test.only('Migrate Old Urls', async () => testMigration());
                test('Add a new Url and verify it is in both stores', async () => {
                    await testMigration();
                    when(clipboard.readText()).thenResolve('https://localhost:9999?token=ABCD');
                    when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);

                    const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

                    assert.ok(handle);
                    const handles = await provider.getHandles();
                    assert.isAtLeast(handles.length, 3, '2 migrated urls and one entered');
                    assert.include(handles, handle);

                    const serversInOldStorage = await provider.oldStorage.getServers();
                    const serversInNewStorage = await provider.newStorage.getServers();

                    assert.isAtLeast(serversInNewStorage.length, 3);
                    assert.deepEqual(
                        serversInOldStorage.sort((a, b) => a.handle.localeCompare(b.handle)),
                        serversInNewStorage.sort((a, b) => a.handle.localeCompare(b.handle))
                    );
                });
            });
        });
    });
});
