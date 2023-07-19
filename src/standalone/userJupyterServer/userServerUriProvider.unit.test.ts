// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
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
    IExperimentService,
    IExtensionContext
} from '../../platform/common/types';
import { IMultiStepInputFactory } from '../../platform/common/utils/multiStepInput';
import {
    UserJupyterServerUriListKey,
    UserJupyterServerUriListKeyV2,
    UserJupyterServerUriListMementoKey,
    UserJupyterServerUrlProvider
} from './userServerUrlProvider';
import { Disposable, InputBox, Memento } from 'vscode';
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
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { Common, DataScience } from '../../platform/common/utils/localize';
import { IJupyterPasswordConnectInfo, JupyterPasswordConnect } from './jupyterPasswordConnect';
import { IFileSystem } from '../../platform/common/platform/types';

/* eslint-disable @typescript-eslint/no-explicit-any, ,  */
suite('User Uri Provider', () => {
    ['Old Password Manager', 'New Password Manager'].forEach((passwordManager) => {
        ['Old Storage Format', 'New Storage Format'].forEach((storageFormat) => {
            suite(`${passwordManager} - ${storageFormat}`, () => {
                const isNewPasswordManager = passwordManager === 'New Password Manager';
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
                let getPasswordConnectionInfoStub: sinon.SinonStub<
                    [
                        {
                            url: string;
                            isTokenEmpty: boolean;
                            displayName?: string | undefined;
                        }
                    ],
                    Promise<IJupyterPasswordConnectInfo>
                >;

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
                    when(experiments.inExperiment(Experiments.PasswordManager)).thenReturn(isNewPasswordManager);
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
                        encryptedStorage.store(
                            Settings.JupyterServerRemoteLaunchService,
                            'user-jupyter-server-uri-list-v2',
                            anything()
                        )
                    ).thenResolve();
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
                    getPasswordConnectionInfoStub = sinon.stub(
                        JupyterPasswordConnect.prototype,
                        'getPasswordConnectionInfo'
                    );
                    getPasswordConnectionInfoStub.resolves({ requiresPassword: false });

                    when(serverUriStorage.add(anything())).thenResolve();
                    when(serverUriStorage.add(anything(), anything())).thenResolve();
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
                        instance(experiments),
                        instance(mock<IExtensionContext>()),
                        instance(mock<IFileSystem>())
                    );
                });
                teardown(async () => {
                    sinon.restore();
                    disposeAllDisposables(disposables);
                    await asyncDisposableRegistry.dispose();
                });

                async function testMigration() {
                    const oldIndexes = [
                        { index: 0, time: Date.now() - 1000 },
                        { index: 1, time: Date.now() - 2000 },
                        { index: 2, time: Date.now() - 3000 }
                    ];
                    when(globalMemento.get(Settings.JupyterServerUriList)).thenReturn(oldIndexes);
                    const oldUrls: string[] = [
                        `http://localhost:1111${Settings.JupyterServerRemoteLaunchNameSeparator}Hello World`,
                        `http://localhost:2222${Settings.JupyterServerRemoteLaunchNameSeparator}Foo Bar`,
                        `${generateIdFromRemoteProvider({ id: '1', handle: '2', extensionId: '' })}${
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
                    assert.deepEqual(
                        servers.map((s) => s.baseUrl),
                        ['http://localhost:1111/', 'http://localhost:2222/']
                    );

                    // Verify the items were added into the Uri Storage ().
                    verify(serverUriStorage.add(anything(), anything())).atLeast(2);

                    // Verify the items were added into both of the stores.
                    const serversInOldStorage = await provider.oldStorage.getServers();
                    const serversInNewStorage = await provider.newStorage.getServers();

                    assert.strictEqual(serversInNewStorage.length, 2);
                    assert.deepEqual(
                        serversInOldStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri),
                        serversInNewStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri)
                    );
                }
                test('Migrate Old Urls', async () => testMigration());
                test('Add a new Url and verify it is in both stores', async () => {
                    await testMigration();
                    when(clipboard.readText()).thenResolve('https://localhost:3333?token=ABCD');
                    when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);

                    const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

                    verify(
                        applicationShell.showWarningMessage(
                            DataScience.insecureSessionMessage,
                            Common.bannerLabelYes,
                            Common.bannerLabelNo
                        )
                    ).never();
                    assert.ok(handle);
                    const handles = await provider.getHandles();
                    assert.isAtLeast(handles.length, 3, '2 migrated urls and one entered');
                    assert.include(handles, handle);

                    const serversInOldStorage = await provider.oldStorage.getServers();
                    const serversInNewStorage = await provider.newStorage.getServers();

                    assert.strictEqual(serversInNewStorage.length, 3);
                    assert.deepEqual(
                        serversInOldStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri),
                        serversInNewStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri)
                    );
                });
                test('When adding a HTTP url (without pwd, and without a token) prompt user to use insecure sites (in new pwd manager)', async function () {
                    if (!isNewPasswordManager) {
                        return this.skip();
                    }
                    await testMigration();
                    when(clipboard.readText()).thenResolve('http://localhost:3333');
                    when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);
                    when(
                        applicationShell.showWarningMessage(
                            DataScience.insecureSessionMessage,
                            Common.bannerLabelYes,
                            Common.bannerLabelNo
                        )
                    ).thenResolve(Common.bannerLabelYes as any);

                    const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

                    verify(
                        applicationShell.showWarningMessage(
                            DataScience.insecureSessionMessage,
                            Common.bannerLabelYes,
                            Common.bannerLabelNo
                        )
                    ).once();
                    assert.ok(handle);
                    const handles = await provider.getHandles();
                    assert.isAtLeast(handles.length, 3, '2 migrated urls and one entered');
                    assert.include(handles, handle);

                    const serversInOldStorage = await provider.oldStorage.getServers();
                    const serversInNewStorage = await provider.newStorage.getServers();

                    assert.strictEqual(serversInNewStorage.length, 3);
                    assert.deepEqual(
                        serversInOldStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri),
                        serversInNewStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri)
                    );
                });
                test('When prompted to use insecure sites and ignored/cancelled, then do not add the url', async function () {
                    if (!isNewPasswordManager) {
                        return this.skip();
                    }
                    await testMigration();
                    when(clipboard.readText()).thenResolve('http://localhost:3333');
                    when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);
                    when(
                        applicationShell.showWarningMessage(
                            DataScience.insecureSessionMessage,
                            Common.bannerLabelYes,
                            Common.bannerLabelNo
                        )
                    ).thenResolve();

                    const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

                    verify(
                        applicationShell.showWarningMessage(
                            DataScience.insecureSessionMessage,
                            Common.bannerLabelYes,
                            Common.bannerLabelNo
                        )
                    ).once();
                    assert.isUndefined(handle);
                    const handles = await provider.getHandles();
                    assert.isAtLeast(handles.length, 2, '2 migrated urls');

                    const serversInOldStorage = await provider.oldStorage.getServers();
                    const serversInNewStorage = await provider.newStorage.getServers();

                    assert.strictEqual(serversInNewStorage.length, 2);
                    assert.deepEqual(
                        serversInOldStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri),
                        serversInNewStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri)
                    );
                });
                test('When adding a HTTP url (with a pwd, and without a token) do not prompt user to use insecure sites (in new pwd manager)', async function () {
                    if (!isNewPasswordManager) {
                        return this.skip();
                    }
                    await testMigration();
                    getPasswordConnectionInfoStub.restore();
                    getPasswordConnectionInfoStub.reset();
                    sinon
                        .stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo')
                        .resolves({ requiresPassword: true });
                    when(clipboard.readText()).thenResolve('http://localhost:3333');
                    when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);
                    when(
                        applicationShell.showWarningMessage(
                            DataScience.insecureSessionMessage,
                            Common.bannerLabelYes,
                            Common.bannerLabelNo
                        )
                    ).thenResolve(Common.bannerLabelYes as any);

                    const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

                    verify(
                        applicationShell.showWarningMessage(
                            DataScience.insecureSessionMessage,
                            Common.bannerLabelYes,
                            Common.bannerLabelNo
                        )
                    ).never();
                    assert.ok(handle);
                    const handles = await provider.getHandles();
                    assert.isAtLeast(handles.length, 3, '2 migrated urls and one entered');
                    assert.include(handles, handle);

                    const serversInOldStorage = await provider.oldStorage.getServers();
                    const serversInNewStorage = await provider.newStorage.getServers();

                    assert.strictEqual(serversInNewStorage.length, 3);
                    assert.deepEqual(
                        serversInOldStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri),
                        serversInNewStorage.sort((a, b) => a.handle.localeCompare(b.handle)).map((s) => s.uri)
                    );
                });
            });
        });
    });
});
