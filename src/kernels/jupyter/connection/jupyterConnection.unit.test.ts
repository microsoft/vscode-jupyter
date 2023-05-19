// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert, use } from 'chai';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationToken, EventEmitter, Uri } from 'vscode';
import { JupyterConnection } from './jupyterConnection';
import {
    IJupyterServerUriStorage,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration,
    JupyterServerInfo
} from '../types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IConfigurationService, IDisposable, IJupyterSettings } from '../../../platform/common/types';
import chaiAsPromised from 'chai-as-promised';
import events from 'events';
import { Subject } from 'rxjs/Subject';
import sinon from 'sinon';
import { JupyterSettings } from '../../../platform/common/configSettings';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { Output, ObservableExecutionResult } from '../../../platform/common/process/types.node';
import { DataScience } from '../../../platform/common/utils/localize';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IServiceContainer } from '../../../platform/ioc/types';
import { JupyterConnectionWaiter } from '../launcher/jupyterConnection.node';
import { noop } from '../../../test/core';
use(chaiAsPromised);
suite('Jupyter Connection', async () => {
    let jupyterConnection: JupyterConnection;
    let registrationPicker: IJupyterUriProviderRegistration;
    let sessionManagerFactory: IJupyterSessionManagerFactory;
    let sessionManager: IJupyterSessionManager;
    let serverUriStorage: IJupyterServerUriStorage;
    const disposables: IDisposable[] = [];
    setup(() => {
        registrationPicker = mock<IJupyterUriProviderRegistration>();
        sessionManagerFactory = mock<IJupyterSessionManagerFactory>();
        sessionManager = mock<IJupyterSessionManager>();
        serverUriStorage = mock<IJupyterServerUriStorage>();
        jupyterConnection = new JupyterConnection(
            instance(registrationPicker),
            instance(sessionManagerFactory),
            instance(serverUriStorage)
        );

        (instance(sessionManager) as any).then = undefined;
        when(sessionManagerFactory.create(anything(), anything())).thenResolve(instance(sessionManager));
        const serverConnectionChangeEvent = new EventEmitter<void>();
        disposables.push(serverConnectionChangeEvent);

        when(serverUriStorage.onDidChange).thenReturn(serverConnectionChangeEvent.event);
    });
    teardown(() => {
        disposeAllDisposables(disposables);
    });

    test('Validation will result in fetching kernels and kernelspecs', async () => {
        const uri = 'http://localhost:8888/?token=1234';
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenResolve([]);

        await jupyterConnection.validateRemoteUri(uri);

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
    });
    test('Validation will fail if fetching kernels fail', async () => {
        const uri = 'http://localhost:8888/?token=1234';
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenResolve([]);
        when(sessionManager.getRunningKernels()).thenReject(new Error('Kaboom kernels failure'));

        await assert.isRejected(jupyterConnection.validateRemoteUri(uri), 'Kaboom kernels failure');

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
    });
    test('Validation will fail if fetching kernelspecs fail', async () => {
        const uri = 'http://localhost:8888/?token=1234';
        when(sessionManager.dispose()).thenResolve();
        when(sessionManager.getKernelSpecs()).thenReject(new Error('Kaboom kernelspec failure'));
        when(sessionManager.getRunningKernels()).thenResolve([]);

        await assert.isRejected(jupyterConnection.validateRemoteUri(uri), 'Kaboom kernelspec failure');

        verify(sessionManager.getKernelSpecs()).once();
        verify(sessionManager.getRunningKernels()).once();
        verify(sessionManager.dispose()).once();
    });
});

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('JupyterConnection', () => {
    let observableOutput: Subject<Output<string>>;
    let launchResult: ObservableExecutionResult<string>;
    let getServerInfoStub: sinon.SinonStub<[CancellationToken | undefined], JupyterServerInfo[] | undefined>;
    let configService: IConfigurationService;
    let fs: IFileSystemNode;
    let serviceContainer: IServiceContainer;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dsSettings: IJupyterSettings = { jupyterLaunchTimeout: 10_000 } as any;
    const childProc = new events.EventEmitter();
    const notebookDir = Uri.file('someDir');
    const dummyServerInfos: JupyterServerInfo[] = [
        {
            base_url: '1',
            hostname: '111',
            notebook_dir: 'a',
            password: true,
            pid: 1,
            port: 1243,
            secure: false,
            token: 'wow',
            url: 'url'
        },
        {
            base_url: '2',
            hostname: '22',
            notebook_dir: notebookDir.fsPath,
            password: false,
            pid: 13,
            port: 4444,
            secure: true,
            token: 'wow2',
            url: 'url2'
        },
        {
            base_url: '22',
            hostname: '33',
            notebook_dir: 'c',
            password: false,
            pid: 15,
            port: 555,
            secure: true,
            token: 'wow3',
            url: 'url23'
        }
    ];
    const expectedServerInfo = dummyServerInfos[1];

    setup(() => {
        observableOutput = new Subject<Output<string>>();
        launchResult = {
            dispose: noop,
            out: observableOutput,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            proc: childProc as any
        };
        getServerInfoStub = sinon.stub<[CancellationToken | undefined], JupyterServerInfo[] | undefined>();
        serviceContainer = mock(ServiceContainer);
        fs = mock<IFileSystemNode>();
        configService = mock(ConfigurationService);
        const settings = mock(JupyterSettings);
        getServerInfoStub.resolves(dummyServerInfos);
        when(configService.getSettings(anything())).thenReturn(instance(settings));
        when(serviceContainer.get<IFileSystemNode>(IFileSystemNode)).thenReturn(instance(fs));
        when(serviceContainer.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
    });

    function createConnectionWaiter(cancelToken?: CancellationToken) {
        return new JupyterConnectionWaiter(
            launchResult,
            notebookDir,
            Uri.file(EXTENSION_ROOT_DIR),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            getServerInfoStub as any,
            instance(serviceContainer),
            undefined,
            cancelToken
        );
    }
    test('Successfully gets connection info', async () => {
        (<any>dsSettings).jupyterLaunchTimeout = 10_000;
        const waiter = createConnectionWaiter();
        observableOutput.next({ source: 'stderr', out: 'Jupyter listening on http://123.123.123:8888' });

        const connection = await waiter.waitForConnection();

        assert.equal(connection.localLaunch, true);
        assert.equal(connection.baseUrl, expectedServerInfo.url);
        assert.equal(connection.hostName, expectedServerInfo.hostname);
        assert.equal(connection.token, expectedServerInfo.token);
    });
    test('Throw timeout error', async () => {
        (<any>dsSettings).jupyterLaunchTimeout = 10;
        const waiter = createConnectionWaiter();

        const promise = waiter.waitForConnection();

        await assert.isRejected(promise, DataScience.jupyterLaunchTimedOut);
    });
    test('Throw crashed error', async () => {
        const exitCode = 999;
        const waiter = createConnectionWaiter();

        const promise = waiter.waitForConnection();
        childProc.emit('exit', exitCode);
        observableOutput.complete();

        await assert.isRejected(promise, DataScience.jupyterServerCrashed(exitCode));
    });
});
