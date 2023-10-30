// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { JupyterCommands } from '../../platform/common/constants';
import { ExecutionResult, ObservableExecutionResult, SpawnOptions } from '../../platform/common/process/types.node';
import { JupyterServerInfo } from './types';

export interface IJupyterCommand {
    interpreter(): Promise<PythonEnvironment | undefined>;
    exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>>;
}

export const IJupyterCommandFactory = Symbol('IJupyterCommandFactory');
export interface IJupyterCommandFactory {
    createInterpreterCommand(
        command: JupyterCommands,
        moduleName: string,
        args: string[],
        interpreter: PythonEnvironment,
        isActiveInterpreter: boolean
    ): IJupyterCommand;
}

export const IJupyterSubCommandExecutionService = Symbol('IJupyterSubCommandExecutionService');
/**
 * Responsible for execution of jupyter subcommands such as `notebook`, `nbconvert`, etc.
 * The executed code is as follows `python -m jupyter <subcommand>`.
 *
 * @export
 * @interface IJupyterSubCommandExecutionService
 */
export interface IJupyterSubCommandExecutionService {
    /**
     * Checks whether notebook is supported.
     *
     * @param {CancellationToken} [cancelToken]
     * @returns {Promise<boolean>}
     * @memberof IJupyterSubCommandExecutionService
     */
    isNotebookSupported(cancelToken?: CancellationToken): Promise<boolean>;
    /**
     * Error message indicating why jupyter notebook isn't supported.
     *
     * @returns {Promise<string>}
     * @memberof IJupyterSubCommandExecutionService
     */
    getReasonForJupyterNotebookNotBeingSupported(): Promise<string>;
    /**
     * Used to refresh the command finder.
     *
     * @returns {Promise<void>}
     * @memberof IJupyterSubCommandExecutionService
     */
    refreshCommands(): Promise<void>;
    /**
     * Gets the interpreter to be used for starting of jupyter server.
     *
     * @param {CancellationToken} [token]
     * @returns {(Promise<PythonEnvironment | undefined>)}
     * @memberof IJupyterInterpreterService
     */
    getSelectedInterpreter(token?: CancellationToken): Promise<PythonEnvironment | undefined>;
    /**
     * Starts the jupyter notebook server
     *
     * @param {string[]} notebookArgs
     * @param {SpawnOptions} options
     * @returns {Promise<ObservableExecutionResult<string>>}
     * @memberof IJupyterSubCommandExecutionService
     */
    startNotebook(notebookArgs: string[], options: SpawnOptions): Promise<ObservableExecutionResult<string>>;
    /**
     * Gets a list of all locally running jupyter notebook servers.
     *
     * @param {CancellationToken} [token]
     * @returns {(Promise<JupyterServerInfo[] | undefined>)}
     * @memberof IJupyterSubCommandExecutionService
     */
    getRunningJupyterServers(token?: CancellationToken): Promise<JupyterServerInfo[] | undefined>;
}
