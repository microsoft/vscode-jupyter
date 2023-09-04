// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert, use } from 'chai';

import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationToken, Uri } from 'vscode';
import { IJupyterRequestAgentCreator, IJupyterRequestCreator, JupyterServerInfo } from '../types';
import chaiAsPromised from 'chai-as-promised';
import events from 'events';
import { Subject } from 'rxjs/Subject';
import sinon from 'sinon';
import { JupyterSettings } from '../../../platform/common/configSettings';
import { ConfigurationService } from '../../../platform/common/configuration/service.node';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { Output, ObservableExecutionResult } from '../../../platform/common/process/types.node';
import { IConfigurationService, IJupyterSettings } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IServiceContainer } from '../../../platform/ioc/types';
import { JupyterConnectionWaiter } from './jupyterConnectionWaiter.node';
import { noop } from '../../../test/core';
use(chaiAsPromised);
suite('Jupyter Connection Waiter', async () => {
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
            base_url: 'http://localhost1:1',
            hostname: 'localhost1',
            notebook_dir: 'a',
            password: true,
            pid: 1,
            port: 1243,
            secure: false,
            token: 'wow',
            url: 'http://localhost:1'
        },
        {
            base_url: 'http://localhost2:2',
            hostname: 'localhost2',
            notebook_dir: notebookDir.fsPath,
            password: false,
            pid: 13,
            port: 4444,
            secure: true,
            token: 'wow2',
            url: 'http://localhost2:2'
        },
        {
            base_url: 'http://localhost3:22',
            hostname: 'localhost3',
            notebook_dir: 'c',
            password: false,
            pid: 15,
            port: 555,
            secure: true,
            token: 'wow3',
            url: 'http://localhost22:22'
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
        when(serviceContainer.get<IJupyterRequestCreator>(IJupyterRequestCreator)).thenReturn(
            instance(mock<IJupyterRequestCreator>())
        );
        when(serviceContainer.get<IJupyterRequestAgentCreator>(IJupyterRequestAgentCreator)).thenReturn(
            instance(mock<IJupyterRequestAgentCreator>())
        );
    });

    function createConnectionWaiter() {
        return new JupyterConnectionWaiter(
            launchResult,
            notebookDir,
            Uri.file(EXTENSION_ROOT_DIR),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            getServerInfoStub as any,
            instance(serviceContainer),
            undefined
        );
    }
    test('Successfully gets connection info', async () => {
        (<any>dsSettings).jupyterLaunchTimeout = 10_000;
        const waiter = createConnectionWaiter();
        observableOutput.next({ source: 'stderr', out: 'Jupyter listening on http://localhost2:2' });

        const connection = await waiter.ready;

        assert.equal(connection.localLaunch, true);
        assert.equal(connection.baseUrl, expectedServerInfo.url);
        assert.equal(connection.hostName, expectedServerInfo.hostname);
        assert.equal(connection.token, expectedServerInfo.token);
    });
    test('Throw timeout error', async () => {
        (<any>dsSettings).jupyterLaunchTimeout = 10;
        const waiter = createConnectionWaiter();

        const promise = waiter.ready;

        await assert.isRejected(promise, DataScience.jupyterLaunchTimedOut);
    });
    test('Throw crashed error', async () => {
        const exitCode = 999;
        const waiter = createConnectionWaiter();

        const promise = waiter.ready;
        childProc.emit('exit', exitCode);
        observableOutput.complete();

        await assert.isRejected(promise, DataScience.jupyterServerCrashed(exitCode));
    });
});
