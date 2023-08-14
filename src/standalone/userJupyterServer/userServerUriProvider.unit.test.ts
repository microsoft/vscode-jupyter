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
import { IMultiStepInputFactory } from '../../platform/common/utils/multiStepInput';
import {
    UserJupyterServerUriListKey,
    UserJupyterServerUriListKeyV2,
    UserJupyterServerUriListMementoKey,
    UserJupyterServerUrlProvider
} from './userServerUrlProvider';
import { Disposable, InputBox, Memento, QuickPick, QuickPickItem } from 'vscode';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import {
    IClipboard,
    IApplicationShell,
    IEncryptedStorage,
    ICommandManager,
    IApplicationEnvironment
} from '../../platform/common/application/types';
import { noop, sleep } from '../../test/core';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { JVSC_EXTENSION_ID, Settings, UserJupyterServerPickerProviderId } from '../../platform/common/constants';
import { assert } from 'chai';
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { Common, DataScience } from '../../platform/common/utils/localize';
import { IJupyterPasswordConnectInfo, JupyterPasswordConnect } from './jupyterPasswordConnect';
import { IFileSystem } from '../../platform/common/platform/types';
import { JupyterServerCollection } from '../../api';

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
    let quickPick: QuickPick<QuickPickItem>;
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
        quickPick = mock<QuickPick<QuickPickItem>>();
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
        when(serverUriStorage.getAll()).thenResolve([]);
        when(applicationShell.createInputBox()).thenReturn(inputBox);
        when(applicationShell.createQuickPick()).thenReturn(instance(quickPick));
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
        let handles = await provider.getHandles();

        try {
            assert.deepEqual(handles, ['1', '3']);
        } catch {
            // Wait for a while and try again
            await sleep(100);
            handles = await provider.getHandles();
            assert.deepEqual(handles, ['1', '3']);
        }

        const servers = await Promise.all(handles.map((h) => provider.getServerUri(h)));
        assert.strictEqual(servers.length, 2);
        servers.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
        assert.deepEqual(
            servers.map((s) => s.baseUrl),
            ['http://localhost:8080/', 'http://microsoft.com/server']
        );
        assert.deepEqual(
            servers.map((s) => s.displayName),
            ['My Remote Server Name', 'Azure ML']
        );

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
    test('Add a new Url and verify it is in the storage', async () => {
        await testMigration();
        when(clipboard.readText()).thenResolve('https://localhost:3333?token=ABCD');
        when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);

        const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

        assert.ok(handle);
        const handles = await provider.getHandles();
        assert.isAtLeast(handles.length, 3, '2 migrated urls and one entered');
        assert.include(handles, handle);

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 3);
        assert.strictEqual(serversInNewStorage2.length, 3);
    });
    test('When adding a HTTP url (without pwd, and without a token) prompt user to use insecure sites (in new pwd manager)', async function () {
        await testMigration();
        when(clipboard.readText()).thenResolve('http://localhost:3333');
        when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);
        when(quickPick.onDidAccept(anything(), anything(), anything())).thenCall((cb) => {
            when(quickPick.selectedItems).thenReturn([{ label: Common.bannerLabelYes }]);
            cb();
        });
        const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

        assert.ok(handle);
        const handles = await provider.getHandles();
        assert.isAtLeast(handles.length, 3, '2 migrated urls and one entered');
        assert.include(handles, handle);

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 3);
        assert.strictEqual(serversInNewStorage2.length, 3);
    });
    test('When prompted to use insecure sites and ignored/cancelled, then do not add the url', async function () {
        await testMigration();
        when(clipboard.readText()).thenResolve('http://localhost:3333');
        when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);
        when(quickPick.onDidAccept(anything(), anything(), anything())).thenCall((cb) => {
            when(quickPick.selectedItems).thenReturn([]);
            cb();
        });

        const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

        assert.isUndefined(handle);
        const handles = await provider.getHandles();
        assert.isAtLeast(handles.length, 2, '2 migrated urls');

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
        when(clipboard.readText()).thenResolve('http://localhost:3333');
        when(applicationShell.showInputBox(anything())).thenResolve('Foo Bar' as any);

        const handle = await provider.handleQuickPick({ label: DataScience.jupyterSelectURIPrompt }, false);

        assert.ok(handle);
        const handles = await provider.getHandles();
        assert.isAtLeast(handles.length, 3, '2 migrated urls and one entered');
        assert.include(handles, handle);

        const [serversInNewStorage, serversInNewStorage2] = await Promise.all([
            provider.newStorage.getServers(false),
            provider.newStorage.getServers(true)
        ]);
        assert.strictEqual(serversInNewStorage.length, 3);
        assert.strictEqual(serversInNewStorage2.length, 3);
    });
});
