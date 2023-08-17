// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import {
    IJupyterRequestCreator,
    IJupyterServerProviderRegistry,
    IJupyterServerUriStorage
} from '../../kernels/jupyter/types';
import {
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IExtensionContext
} from '../../platform/common/types';
import { IMultiStepInputFactory, InputFlowAction } from '../../platform/common/utils/multiStepInput';
import {
    SecureConnectionValidator,
    UserJupyterServerDisplayName,
    UserJupyterServerUriInput,
    UserJupyterServerUriListKey,
    UserJupyterServerUriListKeyV2,
    UserJupyterServerUriListMementoKey,
    UserJupyterServerUrlProvider
} from './userServerUrlProvider';
import { CancellationToken, CancellationTokenSource, Disposable, InputBox, Memento } from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import {
    IClipboard,
    IApplicationShell,
    IEncryptedStorage,
    ICommandManager,
    IApplicationEnvironment
} from '../../platform/common/application/types';
import { noop } from '../../test/core';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { JVSC_EXTENSION_ID, Settings, UserJupyterServerPickerProviderId } from '../../platform/common/constants';
import { assert } from 'chai';
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { IJupyterPasswordConnectInfo, JupyterPasswordConnect } from './jupyterPasswordConnect';
import { IFileSystem } from '../../platform/common/platform/types';
import { IJupyterServerUri, JupyterServerCollection } from '../../api';

/* eslint-disable @typescript-eslint/no-explicit-any, ,  */
suite('User Uri Provider', () => {
    let provider: UserJupyterServerUrlProvider;
    let clipboard: IClipboard;
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
    let inputBox: InputBox;
    let getPasswordConnectionInfoStub: sinon.SinonStub<
        [
            {
                url: string;
                isTokenEmpty: boolean;
                displayName?: string | undefined;
                handle: string;
            }
        ],
        Promise<IJupyterPasswordConnectInfo>
    >;
    let token: CancellationToken;
    let tokenSource: CancellationTokenSource;
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
        applicationShell = mock<IApplicationShell>();
        configService = mock<IConfigurationService>();
        jupyterConnection = mock<JupyterConnection>();
        encryptedStorage = mock<IEncryptedStorage>();
        serverUriStorage = mock<IJupyterServerUriStorage>();
        globalMemento = mock<Memento>();
        multiStepFactory = mock<IMultiStepInputFactory>();
        commands = mock<ICommandManager>();
        requestCreator = mock<IJupyterRequestCreator>();
        tokenSource = new CancellationTokenSource();
        token = tokenSource.token;
        disposables.push(tokenSource);
        when(serverUriStorage.getAll()).thenResolve([]);
        when(applicationShell.createInputBox()).thenReturn(inputBox);
        when(jupyterConnection.validateRemoteUri(anything())).thenResolve();
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
            encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKey)
        ).thenResolve();
        when(
            encryptedStorage.store(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKey, anything())
        ).thenCall((_, __, v) => {
            when(
                encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKey)
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
            encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKeyV2)
        ).thenResolve();
        when(
            encryptedStorage.store(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKeyV2, anything())
        ).thenCall((_, __, v) => {
            when(
                encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKeyV2)
            ).thenReturn(v);
            return Promise.resolve();
        });
        getPasswordConnectionInfoStub = sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo');
        getPasswordConnectionInfoStub.resolves({ requiresPassword: false });

        when(serverUriStorage.add(anything())).thenResolve();
        when(serverUriStorage.add(anything(), anything())).thenResolve();
        const jupyterServerProviderRegistry = mock<IJupyterServerProviderRegistry>();
        const collection = mock<JupyterServerCollection>();
        when(collection.dispose()).thenReturn();
        when(
            jupyterServerProviderRegistry.createJupyterServerCollection(anything(), anything(), anything())
        ).thenReturn(instance(collection));
        const appEnv = mock<IApplicationEnvironment>();
        when(appEnv.channel).thenReturn('stable');
        provider = new UserJupyterServerUrlProvider(
            instance(clipboard),
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
            instance(mock<IExtensionContext>()),
            instance(mock<IFileSystem>()),
            instance(jupyterServerProviderRegistry)
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
        const servers = await provider.getJupyterServers(token);
        assert.strictEqual(servers.length, 2);

        const serverUris = await Promise.all(servers.map((s) => provider.resolveConnectionInformation(s, token)));
        serverUris.sort((a, b) => a.baseUrl.toString().localeCompare(b.baseUrl.toString()));
        assert.deepEqual(
            serverUris.map((s) => s.baseUrl.toString()),
            ['http://localhost:1111/', 'http://localhost:2222/']
        );

        // Verify the items were added into the Uri Storage ().
        verify(serverUriStorage.add(anything(), anything())).atLeast(2);

        // Verify the items were added into both of the stores.
        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.deepEqual(
            serversInNewStorage.map((s) => s.serverInfo.displayName),
            ['Hello World', 'Foo Bar']
        );
        assert.deepEqual(
            serversInNewStorage2.map((s) => s.serverInfo.displayName),
            ['Hello World', 'Foo Bar']
        );
    }
    test('Migrate Old Urls', async () => testMigration());
    test('Migrate display names from Uri Storage', async () => {
        const dataInUserJupyterServerStorage = [
            {
                handle: '1',
                uri: 'http://microsoft.com/server'
            },
            {
                handle: '3',
                uri: 'http://localhost:8080'
            }
        ];
        when(
            encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, UserJupyterServerUriListKeyV2)
        ).thenResolve(JSON.stringify(dataInUserJupyterServerStorage));
        when(serverUriStorage.getAll()).thenResolve([
            {
                provider: {
                    extensionId: JVSC_EXTENSION_ID,
                    handle: '1',
                    id: UserJupyterServerPickerProviderId
                },
                time: Date.now() - 1000,
                displayName: 'Azure ML'
            },
            {
                provider: {
                    extensionId: JVSC_EXTENSION_ID,
                    handle: '3',
                    id: UserJupyterServerPickerProviderId
                },
                time: Date.now() - 1000,
                displayName: 'My Remote Server Name'
            }
        ]);
        provider.activate();
        const servers = await provider.getJupyterServers(token);

        assert.deepEqual(
            servers.map((s) => s.id),
            ['1', '3']
        );

        const serverUris = await Promise.all(servers.map((h) => provider.resolveConnectionInformation(h, token)));
        assert.strictEqual(servers.length, 2);
        serverUris.sort((a, b) => a.baseUrl.toString().localeCompare(b.baseUrl.toString()));
        assert.deepEqual(serverUris.map((s) => s.baseUrl.toString()).sort(), [
            'http://localhost:8080/',
            'http://microsoft.com/server'
        ]);
        assert.deepEqual(servers.map((s) => s.label).sort(), ['Azure ML', 'My Remote Server Name']);

        // Verify the of the servers have the actual names in the stores.
        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.deepEqual(
            serversInNewStorage.map((s) => s.serverInfo.displayName),
            ['Azure ML', 'My Remote Server Name']
        );
        assert.deepEqual(
            serversInNewStorage2.map((s) => s.serverInfo.displayName),
            ['Azure ML', 'My Remote Server Name']
        );
    });
    test('Add the provided Url and verify it is in the storage', async () => {
        await testMigration();
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');
        const getUriFromUserStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        getUriFromUserStub.resolves(undefined);

        const [cmd] = await provider.getCommands('https://localhost:3333?token=ABCD', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }
        if (server instanceof InputFlowAction || server === 'back') {
            throw new Error('Server not returned');
        }

        assert.ok(server.id);
        assert.strictEqual(server.label, 'Foo Bar');
        assert.ok(displayNameStub.called, 'We should have prompted the user for a display name');
        assert.isFalse(getUriFromUserStub.called, 'Should not prompt for a Url, as one was provided');
        const authInfo = await provider.resolveConnectionInformation(server, token);
        assert.strictEqual(authInfo.baseUrl.toString(), 'https://localhost:3333/');

        const servers = await provider.getJupyterServers(token);
        assert.isAtLeast(servers.length, 3, '2 migrated urls and one entered');
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 3);
        assert.strictEqual(serversInNewStorage2.length, 3);
    });
    test('Prompt user for a Url and use what is in clipboard, then verify it is in the storage', async () => {
        await testMigration();
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');
        when(clipboard.readText()).thenResolve('https://localhost:3333?token=ABCD');

        const [cmd] = await provider.getCommands('', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }
        if (server instanceof InputFlowAction || server === 'back') {
            throw new Error('Server not returned');
        }

        assert.ok(server.id);
        assert.strictEqual(server.label, 'Foo Bar');
        assert.ok(displayNameStub.called, 'We should have prompted the user for a display name');
        verify(clipboard.readText()).once();

        const servers = await provider.getJupyterServers(token);
        assert.isAtLeast(servers.length, 3, '2 migrated urls and one entered');
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 3);
        assert.strictEqual(serversInNewStorage2.length, 3);
    });
    test('When adding a HTTPS url (without pwd, and without a token) do not warn user about using insecure connections', async function () {
        await testMigration();
        when(clipboard.readText()).thenResolve('https://localhost:3333');
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(true);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');

        const [cmd] = await provider.getCommands('', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }
        if (server instanceof InputFlowAction || server === 'back') {
            throw new Error('Server not returned');
        }

        assert.ok(server.id);
        assert.strictEqual(server.label, 'Foo Bar');
        assert.isFalse(secureConnectionStub.called);
        const servers = await provider.getJupyterServers(token);
        assert.isAtLeast(servers.length, 3, '2 migrated urls and one entered');
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 3);
        assert.strictEqual(serversInNewStorage2.length, 3);
    });
    test('When adding a HTTP url (without pwd, and without a token) prompt user to use insecure sites (in new pwd manager)', async function () {
        await testMigration();
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(true);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');
        const getUriFromUserStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        getUriFromUserStub.resolves(undefined);

        const [cmd] = await provider.getCommands('http://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }
        if (server instanceof InputFlowAction || server === 'back') {
            throw new Error('Server not returned');
        }

        assert.ok(secureConnectionStub.called);
        assert.ok(server);
        const servers = await provider.getJupyterServers(token);
        assert.isAtLeast(servers.length, 3, '2 migrated urls and one entered');
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 3);
        assert.strictEqual(serversInNewStorage2.length, 3);
    });
    test('When prompted to use insecure sites and ignored/cancelled, then do not add the url', async function () {
        await testMigration();
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(false);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');
        const getUriFromUserStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        getUriFromUserStub.resolves(undefined);

        const [cmd] = await provider.getCommands('http://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        assert.ok(secureConnectionStub.called);
        assert.isUndefined(server);
        const servers = await provider.getJupyterServers(token);
        assert.isAtLeast(servers.length, 2, '2 migrated urls');

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 2);
        assert.strictEqual(serversInNewStorage2.length, 2);
    });
    test('When adding a HTTP url (with a pwd, and without a token) do not prompt user to use insecure sites (in new pwd manager)', async function () {
        await testMigration();
        getPasswordConnectionInfoStub.restore();
        getPasswordConnectionInfoStub.reset();
        sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo').resolves({ requiresPassword: true });
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(false);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');

        const [cmd] = await provider.getCommands('http://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }
        if (server instanceof InputFlowAction || server === 'back') {
            throw new Error('Server not returned');
        }
        assert.isFalse(secureConnectionStub.called);
        const servers = await provider.getJupyterServers(token);
        assert.isAtLeast(servers.length, 3, '2 migrated urls and one entered');
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 3);
        assert.strictEqual(serversInNewStorage2.length, 3);
    });
    test('When pre-populating with https url and without password auth, the next step should be the displayName & back from displayName should get out of this UI flow (without displaying the Url picker)', async () => {
        await testMigration();
        getPasswordConnectionInfoStub.restore();
        getPasswordConnectionInfoStub.reset();
        const urlInputStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        urlInputStub.resolves();
        sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo').resolves({ requiresPassword: false });
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(false);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.rejects(InputFlowAction.back);

        const [cmd] = await provider.getCommands('https://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        assert.strictEqual(server, 'back');
        assert.strictEqual(displayNameStub.callCount, 1);
        assert.strictEqual(urlInputStub.callCount, 0); // Since a url was provided we should never prompt for this, even when clicking back in display name.
    });
    test('When pre-populating with https url and without password auth, the next step should be the displayName & cancel from displayName should get out of this UI flow (without displaying the Url picker)', async () => {
        await testMigration();
        getPasswordConnectionInfoStub.restore();
        getPasswordConnectionInfoStub.reset();
        const urlInputStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        urlInputStub.resolves();
        sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo').resolves({ requiresPassword: false });
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(false);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.rejects(InputFlowAction.cancel);

        const [cmd] = await provider.getCommands('https://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        assert.isUndefined(server);
        assert.strictEqual(displayNameStub.callCount, 1);
        assert.strictEqual(urlInputStub.callCount, 0); // Since a url was provided we should never prompt for this, even when clicking back in display name.
    });
    test('When pre-populating with https url and without password auth, and the server is invalid the next step should be the url display', async () => {
        await testMigration();
        getPasswordConnectionInfoStub.restore();
        getPasswordConnectionInfoStub.reset();
        const urlInputStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        let getUrlFromUserCallCount = 0;
        urlInputStub.callsFake(async (_initialValue, errorMessage, _) => {
            switch (getUrlFromUserCallCount++) {
                case 0: {
                    // Originally we should be called with an error message.
                    assert.isOk(errorMessage, 'Error Message should not be empty');
                    return {
                        jupyterServerUri: {
                            baseUrl: 'https://localhost:9999/',
                            displayName: 'ABCD',
                            token: ''
                        },
                        url: 'https://localhost:9999/?token=ABCD'
                    };
                }
                case 1: {
                    // There should be no error message displayed,
                    // We should have come here from the back button of the display name.
                    assert.isEmpty(errorMessage, 'Error Message should be empty');
                    // Lets get out of here.
                    throw InputFlowAction.back;
                }
                default:
                    throw new Error('Method should not be called again');
            }
        });
        sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo').resolves({ requiresPassword: false });
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.rejects(InputFlowAction.back);
        when(jupyterConnection.validateRemoteUri(anything(), anything(), true)).thenCall(
            (_, uri: IJupyterServerUri) => {
                if (!uri) {
                    return;
                }
                if (uri.baseUrl.startsWith('https://localhost:9999')) {
                    return;
                }
                throw new Error('Remote Connection Failure');
            }
        );

        // Steps
        // 1. First provide a url https://localhost:3333 to a server that is non-existent
        // 2. Verify the error message is displayed and user is prompted to enter the Url again.
        // 3. Next verify the user is prompted for a display name
        // 4. When we click back button on display name ui, ensure we go back to Url ui.
        // 5. Hitting back button on Url ui should exit out completely

        const [cmd] = await provider.getCommands('https://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        assert.strictEqual(server, 'back');
        assert.strictEqual(displayNameStub.callCount, 1);
        assert.strictEqual(urlInputStub.callCount, 2); // Displayed twice, first time for error message, second time when hit back button from display UI.
    });
});
