// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
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
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    Disposable,
    InputBox,
    Memento,
    env
} from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import { IEncryptedStorage } from '../../platform/common/application/types';
import { noop } from '../../test/core';
import { dispose } from '../../platform/common/utils/lifecycle';
import { Settings } from '../../platform/common/constants';
import { assert } from 'chai';
import { IJupyterPasswordConnectInfo, JupyterPasswordConnect } from './jupyterPasswordConnect';
import { IFileSystem } from '../../platform/common/platform/types';
import { IJupyterServerUri, JupyterServerCollection } from '../../api';
import { JupyterHubPasswordConnect } from '../userJupyterHubServer/jupyterHubPasswordConnect';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../test/vscode-mock';

/* eslint-disable @typescript-eslint/no-explicit-any, ,  */
suite('User Uri Provider', () => {
    let provider: UserJupyterServerUrlProvider;
    let configService: IConfigurationService;
    let jupyterConnection: JupyterConnection;
    let encryptedStorage: IEncryptedStorage;
    let serverUriStorage: IJupyterServerUriStorage;
    let globalMemento: Memento;
    let disposables: IDisposable[] = [];
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
        resetVSCodeMocks();
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

        configService = mock<IConfigurationService>();
        jupyterConnection = mock<JupyterConnection>();
        encryptedStorage = mock<IEncryptedStorage>();
        serverUriStorage = mock<IJupyterServerUriStorage>();
        globalMemento = mock<Memento>();
        multiStepFactory = mock<IMultiStepInputFactory>();
        requestCreator = mock<IJupyterRequestCreator>();
        tokenSource = new CancellationTokenSource();
        token = tokenSource.token;
        disposables.push(tokenSource);
        when(mockedVSCodeNamespaces.env.machineId).thenReturn('1');
        when(mockedVSCodeNamespaces.env.openExternal(anything())).thenReturn(Promise.resolve(true));
        when(serverUriStorage.all).thenReturn([]);
        when(mockedVSCodeNamespaces.window.createInputBox()).thenReturn(inputBox);
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
        sinon.stub(JupyterHubPasswordConnect.prototype, 'isJupyterHub').resolves(false);
        getPasswordConnectionInfoStub = sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo');
        getPasswordConnectionInfoStub.resolves({ requiresPassword: false });

        when(serverUriStorage.add(anything())).thenResolve();
        when(serverUriStorage.add(anything(), anything())).thenResolve();
        const jupyterServerProviderRegistry = mock<IJupyterServerProviderRegistry>();
        const collection = mock<JupyterServerCollection>();
        when(collection.dispose()).thenReturn();
        when(
            jupyterServerProviderRegistry.createJupyterServerCollection(anything(), anything(), anything(), anything())
        ).thenReturn(instance(collection));
        provider = new UserJupyterServerUrlProvider(
            instance(configService),
            instance(jupyterConnection),
            instance(encryptedStorage),
            instance(serverUriStorage),
            instance(globalMemento),
            disposables,
            instance(multiStepFactory),
            asyncDisposableRegistry,
            undefined,
            instance(requestCreator),
            instance(mock<IExtensionContext>()),
            instance(mock<IFileSystem>()),
            instance(jupyterServerProviderRegistry)
        );
    });
    teardown(async () => {
        sinon.restore();
        resetVSCodeMocks();
        disposables = dispose(disposables);
        await asyncDisposableRegistry.dispose();
    });

    test('Add the provided Url and verify it is in the storage', async () => {
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');
        const getUriFromUserStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        getUriFromUserStub.resolves(undefined);

        const [cmd] = await provider.provideCommands('https://localhost:3333?token=ABCD', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }

        assert.ok(server.id);
        assert.strictEqual(server.label, 'Foo Bar');
        assert.ok(displayNameStub.called, 'We should have prompted the user for a display name');
        assert.isFalse(getUriFromUserStub.called, 'Should not prompt for a Url, as one was provided');
        const authInfo = await provider.resolveJupyterServer(server, token);
        assert.strictEqual(authInfo.connectionInformation.baseUrl.toString(), 'https://localhost:3333/');

        const servers = await provider.provideJupyterServers(token);
        assert.isAtLeast(servers.length, 1);
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 1);
        assert.strictEqual(serversInNewStorage2.length, 1);
    });
    test('Prompt user for a Url and use what is in clipboard, then verify it is in the storage', async () => {
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');
        void env.clipboard.writeText('https://localhost:3333?token=ABCD');

        const [cmd] = await provider.provideCommands('', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }

        assert.ok(server.id);
        assert.strictEqual(server.label, 'Foo Bar');
        assert.ok(displayNameStub.called, 'We should have prompted the user for a display name');

        const servers = await provider.provideJupyterServers(token);
        assert.isAtLeast(servers.length, 1);
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 1);
        assert.strictEqual(serversInNewStorage2.length, 1);
    });
    test('When adding a HTTPS url (without pwd, and without a token) do not warn user about using insecure connections', async function () {
        void env.clipboard.writeText('https://localhost:3333');
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(true);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');

        const [cmd] = await provider.provideCommands('', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }

        assert.ok(server.id);
        assert.strictEqual(server.label, 'Foo Bar');
        assert.isFalse(secureConnectionStub.called);
        const servers = await provider.provideJupyterServers(token);
        assert.isAtLeast(servers.length, 1);
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 1);
        assert.strictEqual(serversInNewStorage2.length, 1);
    });
    test('When adding a HTTP url (without pwd, and without a token) prompt user to use insecure sites (in new pwd manager)', async function () {
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(true);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');
        const getUriFromUserStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        getUriFromUserStub.resolves(undefined);

        const [cmd] = await provider.provideCommands('http://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }

        assert.ok(secureConnectionStub.called);
        assert.ok(server);
        const servers = await provider.provideJupyterServers(token);
        assert.isAtLeast(servers.length, 1);
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 1);
        assert.strictEqual(serversInNewStorage2.length, 1);
    });
    test('When prompted to use insecure sites and ignored/cancelled, then do not add the url', async function () {
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(false);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');
        const getUriFromUserStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        getUriFromUserStub.resolves(undefined);

        const [cmd] = await provider.provideCommands('http://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token).catch((ex) => {
            if (ex instanceof CancellationError) {
                return undefined;
            }
            return Promise.reject(ex);
        });

        assert.ok(secureConnectionStub.called);
        assert.isUndefined(server);
        const servers = await provider.provideJupyterServers(token);
        assert.isAtLeast(servers.length, 0);

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 0);
        assert.strictEqual(serversInNewStorage2.length, 0);
    });
    test('When adding a HTTP url (with a pwd, and without a token) do not prompt user to use insecure sites (in new pwd manager)', async function () {
        getPasswordConnectionInfoStub.restore();
        getPasswordConnectionInfoStub.reset();
        sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo').resolves({ requiresPassword: true });
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(false);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.resolves('Foo Bar');

        const [cmd] = await provider.provideCommands('http://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        if (!server) {
            throw new Error('Server not returned');
        }
        assert.isFalse(secureConnectionStub.called);
        const servers = await provider.provideJupyterServers(token);
        assert.isAtLeast(servers.length, 1);
        assert.include(
            servers.map((s) => s.id),
            server.id
        );

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 1);
        assert.strictEqual(serversInNewStorage2.length, 1);
    });
    test('When pre-populating with https url and without password auth, the next step should be the displayName & back from displayName should get out of this UI flow (without displaying the Url picker)', async () => {
        getPasswordConnectionInfoStub.restore();
        getPasswordConnectionInfoStub.reset();
        const urlInputStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        urlInputStub.resolves();
        sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo').resolves({ requiresPassword: false });
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(false);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.rejects(InputFlowAction.back);

        const [cmd] = await provider.provideCommands('https://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        assert.isUndefined(server);
        assert.strictEqual(displayNameStub.callCount, 1);
        assert.strictEqual(urlInputStub.callCount, 0); // Since a url was provided we should never prompt for this, even when clicking back in display name.
    });
    test('When pre-populating with https url and without password auth, the next step should be the displayName & cancel from displayName should get out of this UI flow (without displaying the Url picker)', async () => {
        getPasswordConnectionInfoStub.restore();
        getPasswordConnectionInfoStub.reset();
        const urlInputStub = sinon.stub(UserJupyterServerUriInput.prototype, 'getUrlFromUser');
        urlInputStub.resolves();
        sinon.stub(JupyterPasswordConnect.prototype, 'getPasswordConnectionInfo').resolves({ requiresPassword: false });
        const secureConnectionStub = sinon.stub(SecureConnectionValidator.prototype, 'promptToUseInsecureConnections');
        secureConnectionStub.resolves(false);
        const displayNameStub = sinon.stub(UserJupyterServerDisplayName.prototype, 'getDisplayName');
        displayNameStub.rejects(InputFlowAction.cancel);

        const [cmd] = await provider.provideCommands('https://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token).catch((ex) => {
            if (ex instanceof CancellationError) {
                return undefined;
            }
            return Promise.reject(ex);
        });

        assert.isUndefined(server);
        assert.strictEqual(displayNameStub.callCount, 1);
        assert.strictEqual(urlInputStub.callCount, 0); // Since a url was provided we should never prompt for this, even when clicking back in display name.
    });
    test('When pre-populating with https url and without password auth, and the server is invalid the next step should be the url display', async () => {
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

        const [cmd] = await provider.provideCommands('https://localhost:3333', token);
        const server = await provider.handleCommand(cmd, token);

        assert.isUndefined(server);
        assert.strictEqual(displayNameStub.callCount, 1);
        assert.strictEqual(urlInputStub.callCount, 2); // Displayed twice, first time for error message, second time when hit back button from display UI.
    });
});
