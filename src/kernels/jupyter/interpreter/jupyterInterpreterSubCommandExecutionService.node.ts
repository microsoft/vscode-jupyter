// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { CancellationToken } from 'vscode';
import { traceError, traceVerbose, traceWarning } from '../../../platform/logging';
import {
    IPythonExecutionFactory,
    SpawnOptions,
    ObservableExecutionResult
} from '../../../platform/common/process/types.node';
import { IOutputChannel } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
import { IEnvironmentActivationService } from '../../../platform/interpreter/activation/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { Product } from '../../installer/types';
import { JupyterPaths } from '../../raw/finder/jupyterPaths.node';
import {
    getMessageForLibrariesNotInstalled,
    JupyterInterpreterDependencyService
} from './jupyterInterpreterDependencyService.node';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';
import {
    IJupyterInterpreterDependencyManager,
    JupyterInterpreterDependencyResponse,
    JupyterServerInfo
} from '../types';
import { IJupyterSubCommandExecutionService } from '../types.node';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths.node';
import { JUPYTER_OUTPUT_CHANNEL } from '../../../platform/common/constants';

/**
 * Responsible for execution of jupyter sub commands using a single/global interpreter set aside for launching jupyter server.
 *
 * @export
 * @class JupyterCommandFinderInterpreterExecutionService
 * @implements {IJupyterSubCommandExecutionService}
 */
@injectable()
export class JupyterInterpreterSubCommandExecutionService
    implements IJupyterSubCommandExecutionService, IJupyterInterpreterDependencyManager
{
    constructor(
        @inject(JupyterInterpreterService) private readonly jupyterInterpreter: JupyterInterpreterService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(JupyterInterpreterDependencyService)
        private readonly jupyterDependencyService: JupyterInterpreterDependencyService,
        @inject(IPythonExecutionFactory) private readonly pythonExecutionFactory: IPythonExecutionFactory,
        @inject(IOutputChannel) @named(JUPYTER_OUTPUT_CHANNEL) private readonly jupyterOutputChannel: IOutputChannel,
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
                return DataScience.selectJupyterInterpreter;
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
            return DataScience.jupyterKernelSpecModuleNotFound(interpreter.uri.fsPath);
        }

        return getMessageForLibrariesNotInstalled(productsNotInstalled, interpreter);
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
            DataScience.startingJupyterLogMessage(getDisplayPath(interpreter.uri), notebookArgs.join(' '))
        );
        const executionService = await this.pythonExecutionFactory.createActivatedEnvironment({
            allowEnvironmentFetchExceptions: true,
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
        jupyterDataPaths.push(uriPath.dirname(await this.jupyterPaths.getKernelSpecTempRegistrationFolder()).fsPath);
        spawnOptions.env = {
            ...envVars,
            JUPYTER_PATH: jupyterDataPaths.join(path.delimiter)
        };
        traceVerbose(`Start Jupyter Notebook with JUPYTER_PATH=${jupyterDataPaths.join(path.delimiter)}`);
        traceVerbose(`Start Jupyter Notebook with PYTHONPATH=${envVars['PYTHONPATH'] || ''}`);
        const pathVariables = Object.keys(envVars).filter((key) => key.toLowerCase() === 'path');
        if (pathVariables.length) {
            const pathValues = pathVariables
                .map((pathVariable) => `${pathVariable}=${envVars[pathVariable]}`)
                .join(',');
            traceVerbose(`Start Jupyter Notebook with PATH variable. ${pathValues}`);
        } else {
            traceError(`Start Jupyter Notebook without a PATH variable`);
        }
        return executionService.execModuleObservable('jupyter', ['notebook'].concat(notebookArgs), spawnOptions);
    }

    public async getRunningJupyterServers(token?: CancellationToken): Promise<JupyterServerInfo[] | undefined> {
        const interpreter = await this.getSelectedInterpreterAndThrowIfNotAvailable(token);
        const daemon = await this.pythonExecutionFactory.createActivatedEnvironment({
            allowEnvironmentFetchExceptions: true,
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
