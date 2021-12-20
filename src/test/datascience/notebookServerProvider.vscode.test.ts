// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { Disposable, CancellationTokenSource } from 'vscode';
import { traceInfo } from '../../client/common/logger';
import { DisplayOptions } from '../../client/datascience/displayOptions';
import { IJupyterServerProvider } from '../../client/datascience/types';
import { IS_NON_RAW_NATIVE_TEST } from '../constants';
import { initialize } from '../initialize';
import { closeNotebooksAndCleanUpAfterTests, startJupyterServer } from './notebook/helper';
import * as getFreePort from 'get-port';
import { NotebookServerProvider } from '../../client/datascience/interactive-common/notebookServerProvider';
import { IPythonExecutionFactory } from '../../client/common/process/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IConfigurationService } from '../../client/common/types';
import { JupyterSettings } from '../../client/common/configSettings';

suite('Jupyter CLI Tests', async () => {
    let jupyterServerProvider: NotebookServerProvider;
    let pythonExecFactory: IPythonExecutionFactory;
    let settings: JupyterSettings;
    let disposables: Disposable[] = [];
    let activeInterpreter: PythonEnvironment;
    setup(async function () {
        if (!IS_NON_RAW_NATIVE_TEST) {
            return this.skip();
        }
        traceInfo(`Start Test ${this.currentTest?.title}`);
        const api = await initialize();
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
        if (!IS_NON_RAW_NATIVE_TEST) {
            return this.skip();
        }
        settings.dispose();
        jupyterServerProvider.clear();
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
        jupyterServerProvider.clear();
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
        const connection = await server.getConnectionInfo();
        assert.include(connection!.baseUrl, availablePort.toString(), 'Server started with right port');

        // Verify we have jupyter running on this port.
        const pythonService = await pythonExecFactory.create({ interpreter: activeInterpreter });
        const result = await pythonService.execModule('jupyter', ['notebook', 'list'], {});
        assert.include(result.stdout, `:${availablePort}/?token=`, 'server not started as expected');
    });
});
