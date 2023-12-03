// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert, use } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { JupyterConnection } from './jupyterConnection';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IJupyterRequestAgentCreator, IJupyterRequestCreator, IJupyterServerProviderRegistry } from '../types';
import {
    IConfigurationService,
    IDisposable,
    IWatchableJupyterSettings,
    ReadWrite
} from '../../../platform/common/types';
import chaiAsPromised from 'chai-as-promised';
import { IJupyterServerUri, JupyterServer, JupyterServerCollection, JupyterServerProvider } from '../../../api';
import { IDataScienceErrorHandler } from '../../errors/types';
import { JupyterLabHelper } from '../session/jupyterLabHelper';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { Uri } from 'vscode';
use(chaiAsPromised);
suite('Jupyter Connection', async () => {
    let jupyterConnection: JupyterConnection;
    let registrationPicker: IJupyterServerProviderRegistry;
    let sessionManager: JupyterLabHelper;
    let configService: IConfigurationService;
    let errorHandler: IDataScienceErrorHandler;
    let disposables: IDisposable[] = [];
    let requestAgentCreator: IJupyterRequestAgentCreator;
    let requestCreator: IJupyterRequestCreator;

    const provider = {
        id: 'someProvider',
        handle: 'someHandle',
        extensionId: ''
    };
    const server: IJupyterServerUri = {
        baseUrl: 'http://localhost:8888',
        displayName: 'someDisplayName',
        token: '1234'
    };
    let jupyterServer: JupyterServer;
    let collection: JupyterServerCollection;

    setup(() => {
        jupyterServer = {
            id: provider.handle,
            label: server.displayName,
            connectionInformation: {
                baseUrl: Uri.parse(server.baseUrl),
                token: server.token
            }
        };
        registrationPicker = mock<IJupyterServerProviderRegistry>();
        sessionManager = mock<JupyterLabHelper>();
        configService = mock<IConfigurationService>();
        errorHandler = mock<IDataScienceErrorHandler>();
        requestAgentCreator = mock<IJupyterRequestAgentCreator>();
        requestCreator = mock<IJupyterRequestCreator>();
        collection = mock<JupyterServerCollection>();
        const serverProvier = mock<JupyterServerProvider>();
        when(serverProvier.provideJupyterServers(anything())).thenResolve([jupyterServer] as any);
        when(serverProvier.resolveJupyterServer(anything(), anything())).thenResolve(jupyterServer as any);
        when(collection.id).thenReturn(provider.id);
        when(collection.extensionId).thenReturn(provider.extensionId);
        when(collection.serverProvider).thenReturn(instance(serverProvier));
        when(registrationPicker.jupyterCollections).thenReturn([instance(collection)]);
        jupyterConnection = new JupyterConnection(
            instance(registrationPicker),
            instance(configService),
            instance(errorHandler),
            instance(requestAgentCreator),
            instance(requestCreator)
        );

        when(configService.getSettings(anything())).thenReturn(instance(mock<IWatchableJupyterSettings>()));
        sinon.stub(JupyterLabHelper, 'create').callsFake(() => resolvableInstance(sessionManager));
    });
    teardown(() => {
        sinon.restore();
        disposables = dispose(disposables);
    });
    test('Validation will result in fetching kernels and kernelSpecs (Uri info provided)', async () => {
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve([]);

        await jupyterConnection.validateRemoteUri(provider, server);

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
        verify(
            registrationPicker.activateThirdPartyExtensionAndFindCollection(provider.extensionId, provider.id)
        ).never();
    });
    test('Validation will result in fetching kernels and kernelSpecs (Uri info fetched from provider)', async () => {
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve([]);
        when(
            registrationPicker.activateThirdPartyExtensionAndFindCollection(provider.extensionId, provider.id)
        ).thenResolve(collection);

        await jupyterConnection.validateRemoteUri(provider);

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
    });
    test('Validation will fail if info could not be fetched from provider', async () => {
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve([]);
        when(registrationPicker.jupyterCollections).thenReturn([]);
        when(
            registrationPicker.activateThirdPartyExtensionAndFindCollection(provider.extensionId, provider.id)
        ).thenReject(new Error('Kaboom'));

        await assert.isRejected(jupyterConnection.validateRemoteUri(provider));

        verify(sessionManager.getKernelSpecs()).never();
        verify(sessionManager.getRunningKernels()).never();
        verify(sessionManager.dispose()).never();
        // verify(registrationPicker.getJupyterServerUri(deepEqual(provider))).atLeast(1);
    });
    test('Validation will fail if fetching kernels fail', async () => {
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenReject(new Error('Kaboom kernels failure'));

        await assert.isRejected(jupyterConnection.validateRemoteUri(provider, server), 'Kaboom kernels failure');

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
    });
    test('Validation will fail if fetching kernelspecs fail', async () => {
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenReject(new Error('Kaboom kernelspec failure'));
        when(sessionManager.getRunningKernels()).thenResolve([]);

        await assert.isRejected(jupyterConnection.validateRemoteUri(provider, server), 'Kaboom kernelspec failure');

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
    });
    test('Ensure Auth headers are returned', async () => {
        when(sessionManager.dispose()).thenResolve();
        (jupyterServer as ReadWrite<JupyterServer>).connectionInformation = {
            baseUrl: Uri.parse('http://localhost:8888'),
            token: '1234',
            headers: {
                cookie: 'Hello World',
                token: '1234'
            }
        };
        when(sessionManager.getKernelSpecs()).thenReject(new Error('Kaboom kernelspec failure'));
        when(sessionManager.getRunningKernels()).thenResolve([]);

        const connection = await jupyterConnection.createConnectionInfo(provider);

        assert.ok(connection, 'Connection not returned');
        assert.strictEqual(
            connection.baseUrl,
            jupyterServer.connectionInformation!.baseUrl.toString(false),
            'Base url is incorrect'
        );
        assert.deepEqual(
            connection.getAuthHeader!(),
            jupyterServer.connectionInformation?.headers,
            'Auth Headers are incorrect'
        );
    });
    test('Ensure there is no Auth header', async () => {
        when(sessionManager.dispose()).thenResolve();
        (jupyterServer as ReadWrite<JupyterServer>).connectionInformation = {
            baseUrl: Uri.parse('http://localhost:8888'),
            token: '1234'
        };
        when(sessionManager.getKernelSpecs()).thenReject(new Error('Kaboom kernelspec failure'));
        when(sessionManager.getRunningKernels()).thenResolve([]);

        const connection = await jupyterConnection.createConnectionInfo(provider);

        assert.ok(connection, 'Connection not returned');
        assert.strictEqual(
            connection.baseUrl,
            Uri.parse('http://localhost:8888').toString(false),
            'Base url is incorrect'
        );
        assert.isUndefined(connection.getAuthHeader, 'There should be no auth header');
    });
});
