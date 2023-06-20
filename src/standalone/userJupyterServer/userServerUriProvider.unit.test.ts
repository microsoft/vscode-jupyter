// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { instance, mock, when } from 'ts-mockito';
import {
    IJupyterRequestCreator,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration
} from '../../kernels/jupyter/types';
import {
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IExperimentService
} from '../../platform/common/types';
import { IMultiStepInputFactory } from '../../platform/common/utils/multiStepInput';
import { NewStorage, OldStorage, UserJupyterServerUrlProvider } from './userServerUrlProvider';
import { Memento } from 'vscode';
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

/* eslint-disable @typescript-eslint/no-explicit-any, ,  */
suite('User Uri Provider', () => {
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
            sinon.stub(OldStorage.prototype, 'updateStorage').callsFake(() => sleep(10));
            sinon.stub(NewStorage.prototype, 'clear').callsFake(() => sleep(10));
            sinon.stub(NewStorage.prototype, 'updateStorage').callsFake(() => sleep(10));
            sinon.stub(NewStorage.prototype, 'migrate').callsFake(() => sleep(10));
            sinon.stub(NewStorage.prototype, 'migrationDone').get(() => sleep(10));
        } else {
            sinon.stub(OldStorage.prototype, 'getServers').resolves([]);
            sinon.stub(NewStorage.prototype, 'getServers').resolves([]);
            sinon.stub(OldStorage.prototype, 'updateStorage').resolves();
            sinon.stub(NewStorage.prototype, 'clear').resolves();
            sinon.stub(NewStorage.prototype, 'updateStorage').resolves();
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
