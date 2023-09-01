// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert, use } from 'chai';

import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { JupyterConnection } from './jupyterConnection';
import {
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterSessionManager,
    IOldJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration
} from '../types';
import { dispose } from '../../../platform/common/helpers';
import { IConfigurationService, IDisposable, IWatchableJupyterSettings } from '../../../platform/common/types';
import chaiAsPromised from 'chai-as-promised';
import { IJupyterServerUri } from '../../../api';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IDataScienceErrorHandler } from '../../errors/types';
use(chaiAsPromised);
suite('Jupyter Connection', async () => {
    let jupyterConnection: JupyterConnection;
    let registrationPicker: IJupyterUriProviderRegistration;
    let sessionManagerFactory: IOldJupyterSessionManagerFactory;
    let sessionManager: IJupyterSessionManager;
    let appShell: IApplicationShell;
    let configService: IConfigurationService;
    let errorHandler: IDataScienceErrorHandler;
    const disposables: IDisposable[] = [];
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
    setup(() => {
        registrationPicker = mock<IJupyterUriProviderRegistration>();
        sessionManagerFactory = mock<IOldJupyterSessionManagerFactory>();
        sessionManager = mock<IJupyterSessionManager>();
        appShell = mock<IApplicationShell>();
        configService = mock<IConfigurationService>();
        errorHandler = mock<IDataScienceErrorHandler>();
        requestAgentCreator = mock<IJupyterRequestAgentCreator>();
        requestCreator = mock<IJupyterRequestCreator>();
        jupyterConnection = new JupyterConnection(
            instance(registrationPicker),
            instance(sessionManagerFactory),
            instance(appShell),
            instance(configService),
            instance(errorHandler),
            instance(requestAgentCreator),
            instance(requestCreator)
        );

        when(configService.getSettings(anything())).thenReturn(instance(mock<IWatchableJupyterSettings>()));
        (instance(sessionManager) as any).then = undefined;
        when(sessionManagerFactory.create(anything())).thenResolve(instance(sessionManager));
    });
    teardown(() => {
        dispose(disposables);
    });
    test('Validation will result in fetching kernels and kernelSpecs (Uri info provided)', async () => {
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve([]);

        await jupyterConnection.validateRemoteUri(provider, server);

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
        verify(registrationPicker.getJupyterServerUri(deepEqual(provider))).never();
    });
    test('Validation will result in fetching kernels and kernelSpecs (Uri info fetched from provider)', async () => {
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve([]);
        when(registrationPicker.getJupyterServerUri(deepEqual(provider))).thenResolve(server);

        await jupyterConnection.validateRemoteUri(provider);

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
        verify(registrationPicker.getJupyterServerUri(deepEqual(provider))).atLeast(1);
    });
    test('Validation will fail if info could not be fetched from provider', async () => {
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve([]);
        when(registrationPicker.getJupyterServerUri(anything(), anything())).thenReject(new Error('kaboom'));

        await assert.isRejected(jupyterConnection.validateRemoteUri(provider));

        verify(sessionManager.getKernelSpecs()).never();
        verify(sessionManager.getRunningKernels()).never();
        verify(sessionManager.dispose()).never();
        verify(registrationPicker.getJupyterServerUri(deepEqual(provider))).atLeast(1);
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
        const id = '1';
        const handle = 'handle1';
        const uriInfo: IJupyterServerUri = {
            baseUrl: 'http://localhost:8888',
            displayName: 'someDisplayName',
            token: '1234',
            authorizationHeader: {
                cookie: 'Hello World',
                token: '1234'
            }
        };
        when(registrationPicker.getJupyterServerUri(deepEqual({ id, handle, extensionId: '' }))).thenResolve(uriInfo);
        when(sessionManager.getKernelSpecs()).thenReject(new Error('Kaboom kernelspec failure'));
        when(sessionManager.getRunningKernels()).thenResolve([]);

        const connection = await jupyterConnection.createConnectionInfo({ id, handle, extensionId: '' });

        assert.ok(connection, 'Connection not returned');
        assert.strictEqual(connection.baseUrl, uriInfo.baseUrl, 'Base url is incorrect');
        assert.deepEqual(connection.getAuthHeader!(), uriInfo.authorizationHeader, 'Auth Headers are incorrect');
    });
    test('Ensure there is no Auth header', async () => {
        when(sessionManager.dispose()).thenResolve();
        const id = '1';
        const handle = 'handle1';
        const uriInfo: IJupyterServerUri = {
            baseUrl: 'http://localhost:8888',
            displayName: 'someDisplayName',
            token: '1234'
        };
        when(registrationPicker.getJupyterServerUri(deepEqual({ id, handle, extensionId: '' }))).thenResolve(uriInfo);
        when(sessionManager.getKernelSpecs()).thenReject(new Error('Kaboom kernelspec failure'));
        when(sessionManager.getRunningKernels()).thenResolve([]);

        const connection = await jupyterConnection.createConnectionInfo({ id, handle, extensionId: '' });

        assert.ok(connection, 'Connection not returned');
        assert.strictEqual(connection.baseUrl, uriInfo.baseUrl, 'Base url is incorrect');
        assert.isUndefined(connection.getAuthHeader, 'There should be no auth header');
    });
});
