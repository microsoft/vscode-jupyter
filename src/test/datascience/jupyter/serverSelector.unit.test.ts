// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { assert } from 'chai';
import { anyString, anything, instance, mock, when, verify, deepEqual } from 'ts-mockito';

import * as sinon from 'sinon';
import * as os from 'os';
import { EventEmitter, QuickPickItem } from 'vscode';
import { ApplicationShell } from '../../../platform/common/application/applicationShell';
import { IApplicationShell } from '../../../platform/common/application/types';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { DataScience } from '../../../platform/common/utils/localize';
import { MultiStepInputFactory } from '../../../platform/common/utils/multiStepInput';
import { MockQuickPick } from '../mockQuickPick';
import { MockMemento } from '../../mocks/mementos';
import { WorkspaceService } from '../../../platform/common/application/workspace.node';
import { CryptoUtils } from '../../../platform/common/crypto';
import { ApplicationEnvironment } from '../../../platform/common/application/applicationEnvironment.node';
import { MockEncryptedStorage } from '../mockEncryptedStorage';
import { JupyterServerUriStorage } from '../../../kernels/jupyter/launcher/serverUriStorage';
import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector';
import { JupyterUriProviderRegistration } from '../../../kernels/jupyter/jupyterUriProviderRegistration';
import { Settings } from '../../../platform/common/constants';
import { DataScienceErrorHandler } from '../../../kernels/errors/kernelErrorHandler';
import { IDisposable } from '../../../platform/common/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { JupyterConnection } from '../../../kernels/jupyter/jupyterConnection';
import { IServerConnectionType } from '../../../kernels/jupyter/types';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience - Jupyter Server URI Selector', () => {
    let quickPick: MockQuickPick | undefined;
    let connection: JupyterConnection;
    let applicationShell: IApplicationShell;
    const disposables: IDisposable[] = [];
    function createDataScienceObject(
        quickPickSelection: string,
        hasFolders: boolean
    ): { selector: JupyterServerSelector; storage: JupyterServerUriStorage } {
        const configService = mock(ConfigurationService);
        applicationShell = mock(ApplicationShell);
        const applicationEnv = mock(ApplicationEnvironment);
        const workspaceService = mock(WorkspaceService);
        const picker = mock(JupyterUriProviderRegistration);
        const crypto = mock(CryptoUtils);
        when(crypto.createHash(anyString(), 'string')).thenCall((a1, _a2) => a1);
        quickPick = new MockQuickPick(quickPickSelection);
        when(applicationShell.createQuickPick()).thenReturn(quickPick!);
        when(applicationShell.showErrorMessage(anything(), anything())).thenResolve(undefined);
        when(applicationEnv.machineId).thenReturn(os.hostname());
        const multiStepFactory = new MultiStepInputFactory(instance(applicationShell));
        when(workspaceService.getWorkspaceFolderIdentifier(anything())).thenReturn('1');
        when(workspaceService.hasWorkspaceFolders).thenReturn(hasFolders);
        const encryptedStorage = new MockEncryptedStorage();
        connection = mock<JupyterConnection>();
        when(connection.createConnectionInfo(anything())).thenResolve({ displayName: '' } as any);
        const handler = mock(DataScienceErrorHandler);
        const connectionType = mock<IServerConnectionType>();
        when(connectionType.isLocalLaunch).thenReturn(false);
        when(connection.validateRemoteUri(anything())).thenResolve();
        const onDidChangeEvent = new EventEmitter<void>();
        disposables.push(onDidChangeEvent);
        when(connectionType.onDidChange).thenReturn(onDidChangeEvent.event);
        when(configService.updateSetting(anything(), anything(), anything(), anything())).thenResolve();
        const storage = new JupyterServerUriStorage(
            instance(workspaceService),
            instance(crypto),
            encryptedStorage,
            instance(applicationEnv),
            new MockMemento(),
            false
        );
        const selector = new JupyterServerSelector(
            multiStepFactory,
            instance(picker),
            storage,
            instance(handler),
            instance(applicationShell),
            instance(configService),
            instance(connection),
            false
        );
        return { selector, storage };
    }

    teardown(() => {
        sinon.restore();
        disposeAllDisposables(disposables);
    });

    test('Local pick server uri', async () => {
        const { selector, storage } = createDataScienceObject('', true);
        await selector.selectJupyterURI();
        let value = await storage.getUri();
        assert.equal(value, Settings.JupyterServerLocalLaunch, 'Default should pick local launch');

        // Try a second time.
        await selector.selectJupyterURI();
        value = await storage.getUri();
        assert.equal(value, Settings.JupyterServerLocalLaunch, 'Default should pick local launch');

        // Verify active items
        assert.equal(quickPick?.items.length, 0, 'Wrong number of items in the quick pick');
    });

    test('Local pick server uri with no workspace', async () => {
        const { selector, storage } = createDataScienceObject('', false);
        await selector.selectJupyterURI();
        let value = await storage.getUri();
        assert.equal(value, Settings.JupyterServerLocalLaunch, 'Default should pick local launch');

        // Try a second time.
        await selector.selectJupyterURI();
        value = await storage.getUri();
        assert.equal(value, Settings.JupyterServerLocalLaunch, 'Default should pick local launch');

        // Verify active items
        assert.equal(quickPick?.items.length, 0, 'Wrong number of items in the quick pick');
    });

    test('Quick pick MRU tests', async () => {
        const { selector, storage } = createDataScienceObject('', true);
        console.log('Step1');
        await selector.selectJupyterURI();
        // Verify initial default items
        assert.equal(quickPick?.items.length, 0, 'Wrong number of items in the quick pick');

        // Add in a new server
        const serverA1 = { uri: 'ServerA', time: 1, date: new Date(1) };
        console.log('Step2');
        await storage.addToUriList(serverA1.uri, serverA1.time, serverA1.uri);

        console.log('Step3');
        await selector.selectJupyterURI();
        assert.equal(quickPick?.items.length, 1, 'Wrong number of items in the quick pick');
        quickPickCheck(quickPick?.items[0], serverA1);

        // Add in a second server, the newer server should be higher in the list due to newer time
        const serverB1 = { uri: 'ServerB', time: 2, date: new Date(2) };
        console.log('Step4');
        await storage.addToUriList(serverB1.uri, serverB1.time, serverB1.uri);
        console.log('Step5');
        await selector.selectJupyterURI();
        assert.equal(quickPick?.items.length, 2, 'Wrong number of items in the quick pick');
        quickPickCheck(quickPick?.items[0], serverB1);
        quickPickCheck(quickPick?.items[1], serverA1);

        // Reconnect to server A with a new time, it should now be higher in the list
        const serverA3 = { uri: 'ServerA', time: 3, date: new Date(3) };
        console.log('Step6');
        await storage.addToUriList(serverA3.uri, serverA3.time, serverA3.uri);
        console.log('Step7');
        await selector.selectJupyterURI();
        assert.equal(quickPick?.items.length, 2, 'Wrong number of items in the quick pick');
        quickPickCheck(quickPick?.items[1], serverB1);
        quickPickCheck(quickPick?.items[0], serverA1);

        // Verify that we stick to our settings limit
        for (let i = 0; i < Settings.JupyterServerUriListMax + 10; i = i + 1) {
            console.log(`Step8 ${i} of ${Settings.JupyterServerUriListMax + 10}`);
            await storage.addToUriList(i.toString(), i, i.toString());
        }

        console.log('Step9');
        await selector.selectJupyterURI();
        assert.equal(
            quickPick?.items.length,
            Settings.JupyterServerUriListMax,
            'Wrong number of items in the quick pick'
        );
    });

    function quickPickCheck(item: QuickPickItem | undefined, expected: { uri: string; time: Number; date: Date }) {
        assert.isOk(item, 'Quick pick item not defined');
        if (item) {
            assert.equal(item.label, expected.uri, 'Wrong URI value in quick pick');
            assert.equal(
                item.detail,
                DataScience.jupyterSelectURIMRUDetail().format(expected.date.toLocaleString()),
                'Wrong detail value in quick pick'
            );
        }
    }

    test('Remote server uri', async () => {
        const { selector, storage } = createDataScienceObject('http://localhost:1111', true);
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'http://localhost:1111', 'Already running should end up with the user inputed value');
    });
    test('Remote server uri no workspace', async () => {
        const { selector, storage } = createDataScienceObject('http://localhost:1111', false);
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'http://localhost:1111', 'Already running should end up with the user inputed value');
    });

    test('Remote server uri no local', async () => {
        const { selector, storage } = createDataScienceObject('http://localhost:1111', true);
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'http://localhost:1111', 'Already running should end up with the user inputed value');
    });

    test('Remote server uri (reload VSCode if there is a change in settings)', async () => {
        const { selector, storage } = createDataScienceObject('http://localhost:1111', true);
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'http://localhost:1111', 'Already running should end up with the user inputed value');
    });

    test('Remote server uri (do not reload VSCode if there is no change in settings)', async () => {
        const { selector, storage } = createDataScienceObject('http://localhost:1111', true);
        await storage.setUri('http://localhost:1111');

        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'http://localhost:1111', 'Already running should end up with the user inputed value');
    });

    test('Invalid server uri', async () => {
        const { selector, storage } = createDataScienceObject('httx://localhost:1111', true);
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.notEqual(value, 'httx://localhost:1111', 'Already running should validate');
        assert.equal(value, 'local', 'Validation failed');
    });

    test('Server is validated', async () => {
        const { selector, storage } = createDataScienceObject('https://localhost:1111', true);
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'https://localhost:1111', 'Validation failed');
        verify(connection.validateRemoteUri('https://localhost:1111')).atLeast(1);
    });

    test('Remote authorization is asked when ssl cert is invalid and works', async () => {
        const { selector, storage } = createDataScienceObject('https://localhost:1111', true);
        when(connection.validateRemoteUri(anyString())).thenReject(new Error('reason: self signed certificate'));
        when(
            applicationShell.showErrorMessage(anything(), deepEqual({ modal: true }), anything(), anything())
        ).thenCall((_m, _opt, c1, _c2) => {
            return Promise.resolve(c1);
        });
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'https://localhost:1111', 'Validation failed');
        verify(connection.validateRemoteUri('https://localhost:1111')).atLeast(1);
    });
    test('Remote authorization is asked when ssl cert has expired is invalid and works', async () => {
        const { selector, storage } = createDataScienceObject('https://localhost:1111', true);
        when(connection.validateRemoteUri(anyString())).thenReject(new Error('reason: certificate has expired'));
        when(
            applicationShell.showErrorMessage(anything(), deepEqual({ modal: true }), anything(), anything())
        ).thenCall((_m, _opt, c1, _c2) => {
            return Promise.resolve(c1);
        });
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'https://localhost:1111', 'Validation failed');
        verify(connection.validateRemoteUri('https://localhost:1111')).atLeast(1);
    });

    test('Remote authorization is asked for usage of self signed ssl cert and skipped', async () => {
        const { selector, storage } = createDataScienceObject('https://localhost:1111', true);
        when(connection.validateRemoteUri(anyString())).thenReject(new Error('reason: self signed certificate'));
        when(applicationShell.showErrorMessage(anything(), anything(), anything())).thenCall((_m, _c1, c2) => {
            return Promise.resolve(c2);
        });
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'local', 'Should not be a remote URI');
        verify(connection.validateRemoteUri('https://localhost:1111')).once();
    });

    test('Fails to connect to remote jupyter server, hence remote jupyter server is not used', async () => {
        const { selector, storage } = createDataScienceObject('https://localhost:1111', true);
        when(connection.validateRemoteUri(anyString())).thenReject(new Error('Failed to connect to remote server'));
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'local', 'Should not be a remote URI');
        verify(connection.validateRemoteUri('https://localhost:1111')).once();
    });

    test('Remote authorization is asked and skipped for a different error', async () => {
        const { selector, storage } = createDataScienceObject('https://localhost:1111', true);
        when(connection.validateRemoteUri(anyString())).thenReject(new Error('different error'));
        await selector.selectJupyterURI();
        const value = await storage.getUri();
        assert.equal(value, 'local', 'Should not be a remote URI');
        verify(connection.validateRemoteUri('https://localhost:1111')).once();
    });
});
