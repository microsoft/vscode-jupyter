// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { Disposable, CancellationTokenSource } from 'vscode';
import { traceInfo } from '../../platform/logging';
import { IS_NON_RAW_NATIVE_TEST } from '../constants.node';
import { initialize } from '../initialize.node';
import { closeNotebooksAndCleanUpAfterTests, startJupyterServer } from './notebook/helper.node';
import getFreePort from 'get-port';
import { IPythonExecutionFactory } from '../../platform/common/process/types.node';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { IConfigurationService } from '../../platform/common/types';
import { JupyterSettings } from '../../platform/common/configSettings';
import { IServiceContainer } from '../../platform/ioc/types';
import { HostJupyterExecution } from '../../kernels/jupyter/launcher/liveshare/hostJupyterExecution';
import { NotebookServerProvider } from '../../kernels/jupyter/launcher/notebookServerProvider';
import { IJupyterExecution, IJupyterServerProvider } from '../../kernels/jupyter/types';
import { DisplayOptions } from '../../kernels/displayOptions';

suite('Jupyter CLI Tests @jupyter', async () => {
    let jupyterServerProvider: NotebookServerProvider;
    let pythonExecFactory: IPythonExecutionFactory;
    let settings: JupyterSettings;
    let disposables: Disposable[] = [];
    let activeInterpreter: PythonEnvironment;
    let serviceContainer: IServiceContainer;
    setup(async function () {
        if (!IS_NON_RAW_NATIVE_TEST()) {
            return this.skip();
        }
        traceInfo(`Start Test ${this.currentTest?.title}`);
        const api = await initialize();
        serviceContainer = api.serviceContainer;
        jupyterServerProvider = api.serviceContainer.get<NotebookServerProvider>(IJupyterServerProvider);
        pythonExecFactory = api.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        settings = api.serviceContainer
            .get<IConfigurationService>(IConfigurationService)
            .getSettings(undefined) as JupyterSettings;
        const interpreter = await api.serviceContainer
            .get<IInterpreterService>(IInterpreterService)
            .getActiveInterpreter(undefined);
        settings.dispose();
        activeInterpreter = interpreter!;
        await startJupyterServer();
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        if (!IS_NON_RAW_NATIVE_TEST()) {
            return this.skip();
        }
        settings.dispose();
        jupyterServerProvider.clearCache();
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Test command line args for Jupyter', async () => {
        const tokenSource = new CancellationTokenSource();
        // Verify port is free.
        const availablePort = await getFreePort({ host: 'localhost' });
        settings.jupyterCommandLineArguments = [`--NotebookApp.port=${availablePort}`];
        disposables.push(tokenSource);
        jupyterServerProvider.clearCache();
        serviceContainer.get<HostJupyterExecution>(IJupyterExecution).clearCache();
        const server = await jupyterServerProvider.getOrCreateServer({
            localJupyter: true,
            resource: undefined,
            token: tokenSource.token,
            ui: new DisplayOptions(true)
        });
        if (!server) {
            throw new Error('No server');
        }
        disposables.push(server);
        assert.include(server.connection.baseUrl, availablePort.toString(), 'Server started with right port');

        // Verify we have jupyter running on this port.
        const pythonService = await pythonExecFactory.create({ interpreter: activeInterpreter });
        const result = await pythonService.execModule('jupyter', ['notebook', 'list'], {});
        assert.include(result.stdout, `:${availablePort}/?token=`, 'server not started as expected');
    });
});
