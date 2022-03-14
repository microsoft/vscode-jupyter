// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import { CancellationToken } from 'vscode';
import { traceWarning } from '../../../client/common/logger';
import {
    IPythonExecutionFactory,
    SpawnOptions,
    ObservableExecutionResult,
    IPythonDaemonExecutionService
} from '../../../client/common/process/types';
import { IOutputChannel, IPathUtils } from '../../../client/common/types';
import { DataScience } from '../../../client/common/utils/localize';
import { noop } from '../../../client/common/utils/misc';
import { EXTENSION_ROOT_DIR } from '../../../client/constants';
import {
    IJupyterSubCommandExecutionService,
    IJupyterInterpreterDependencyManager
} from '../../../client/datascience/types';
import { IEnvironmentActivationService } from '../../../client/interpreter/activation/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../client/telemetry';
import { JUPYTER_OUTPUT_CHANNEL, Telemetry, JupyterDaemonModule } from '../../../datascience-ui/common/constants';
import { JupyterInstallError } from '../../../extension/errors/jupyterInstallError';
import { Product } from '../../installer/types';
import { JupyterPaths } from '../../raw/finder/jupyterPaths';
import { JupyterServerInfo } from '../launcher/jupyterConnection';
import {
    getMessageForLibrariesNotInstalled,
    JupyterInterpreterDependencyResponse,
    JupyterInterpreterDependencyService
} from './jupyterInterpreterDependencyService';
import { JupyterInterpreterService } from './jupyterInterpreterService';

/**
 * Responsible for execution of jupyter sub commands using a single/global interpreter set aside for launching jupyter server.
 *
 * @export
 * @class JupyterCommandFinderInterpreterExecutionService
 * @implements {IJupyterSubCommandExecutionService}
 */
@injectable()
export class JupyterInterpreterSubCommandExecutionService
    implements IJupyterSubCommandExecutionService, IJupyterInterpreterDependencyManager {
    constructor(
        @inject(JupyterInterpreterService) private readonly jupyterInterpreter: JupyterInterpreterService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(JupyterInterpreterDependencyService)
        private readonly jupyterDependencyService: JupyterInterpreterDependencyService,
        @inject(IPythonExecutionFactory) private readonly pythonExecutionFactory: IPythonExecutionFactory,
        @inject(IOutputChannel) @named(JUPYTER_OUTPUT_CHANNEL) private readonly jupyterOutputChannel: IOutputChannel,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(JupyterPaths) private readonly jupyterPaths: JupyterPaths,
        @inject(IEnvironmentActivationService) private readonly activationHelper: IEnvironmentActivationService
    ) {}

    /**
     * This is a noop, implemented for backwards compatibility.
     *
     * @returns {Promise<void>}
     * @memberof JupyterInterpreterSubCommandExecutionService
     */
    public async refreshCommands(): Promise<void> {
        noop();
    }
    public async isNotebookSupported(token?: CancellationToken): Promise<boolean> {
        const interpreter = await this.jupyterInterpreter.getSelectedInterpreter(token);
        if (!interpreter) {
            return false;
        }
        return this.jupyterDependencyService.areDependenciesInstalled(interpreter, token);
    }
    public async getReasonForJupyterNotebookNotBeingSupported(token?: CancellationToken): Promise<string> {
        let interpreter = await this.jupyterInterpreter.getSelectedInterpreter(token);
        if (!interpreter) {
            // Use current interpreter.
            interpreter = await this.interpreterService.getActiveInterpreter(undefined);
            if (!interpreter) {
                // Unlikely scenario, user hasn't selected python, python extension will fall over.
                // Get user to select something.
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreterMessageDisplayed);
                return DataScience.selectJupyterInterpreter();
            }
        }
        const productsNotInstalled = await this.jupyterDependencyService.getDependenciesNotInstalled(
            interpreter,
            token
        );
        if (productsNotInstalled.length === 0) {
            return '';
        }

        if (productsNotInstalled.length === 1 && productsNotInstalled[0] === Product.kernelspec) {
            return DataScience.jupyterKernelSpecModuleNotFound().format(interpreter.path);
        }

        return getMessageForLibrariesNotInstalled(productsNotInstalled, interpreter.displayName);
    }
    public async getSelectedInterpreter(token?: CancellationToken): Promise<PythonEnvironment | undefined> {
        return this.jupyterInterpreter.getSelectedInterpreter(token);
    }
    public async startNotebook(
        notebookArgs: string[],
        options: SpawnOptions
    ): Promise<ObservableExecutionResult<string>> {
        const interpreter = await this.getSelectedInterpreterAndThrowIfNotAvailable(options.token);
        this.jupyterOutputChannel.appendLine(
            DataScience.startingJupyterLogMessage().format(
                this.pathUtils.getDisplayName(interpreter.path),
                notebookArgs.join(' ')
            )
        );
        const executionService = await this.pythonExecutionFactory.createDaemon<IPythonDaemonExecutionService>({
            daemonModule: JupyterDaemonModule,
            interpreter: interpreter
        });
        // We should never set token for long running processes.
        // We don't want the process to die when the token is cancelled.
        const spawnOptions = { ...options };
        spawnOptions.token = undefined;
        const envVars =
            (await this.activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)) || process.env;
        const jupyterDataPaths = (process.env['JUPYTER_PATH'] || envVars['JUPYTER_PATH'] || '')
            .split(path.delimiter)
            .filter((item) => item.trim().length);
        jupyterDataPaths.push(path.dirname(await this.jupyterPaths.getKernelSpecTempRegistrationFolder()));
        spawnOptions.env = {
            ...envVars,
            JUPYTER_PATH: jupyterDataPaths.join(path.delimiter)
        };

        return executionService.execModuleObservable('jupyter', ['notebook'].concat(notebookArgs), spawnOptions);
    }

    public async getRunningJupyterServers(token?: CancellationToken): Promise<JupyterServerInfo[] | undefined> {
        const interpreter = await this.getSelectedInterpreterAndThrowIfNotAvailable(token);
        const daemon = await this.pythonExecutionFactory.createDaemon<IPythonDaemonExecutionService>({
            daemonModule: JupyterDaemonModule,
            interpreter: interpreter
        });

        // We have a small python file here that we will execute to get the server info from all running Jupyter instances
        const newOptions: SpawnOptions = { mergeStdOutErr: true, token: token };
        const file = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'vscode_datascience_helpers', 'getServerInfo.py');
        const serverInfoString = await daemon.exec([file], newOptions);

        let serverInfos: JupyterServerInfo[];
        try {
            // Parse out our results, return undefined if we can't suss it out
            serverInfos = JSON.parse(serverInfoString.stdout.trim()) as JupyterServerInfo[];
        } catch (err) {
            traceWarning('Failed to parse JSON when getting server info out from getServerInfo.py', err);
            return;
        }
        return serverInfos;
    }

    public async installMissingDependencies(err?: JupyterInstallError): Promise<JupyterInterpreterDependencyResponse> {
        return this.jupyterInterpreter.installMissingDependencies(err);
    }

    private async getSelectedInterpreterAndThrowIfNotAvailable(token?: CancellationToken): Promise<PythonEnvironment> {
        const interpreter = await this.jupyterInterpreter.getSelectedInterpreter(token);
        if (!interpreter) {
            const reason = await this.getReasonForJupyterNotebookNotBeingSupported();
            throw new JupyterInstallError(reason);
        }
        return interpreter;
    }
}
