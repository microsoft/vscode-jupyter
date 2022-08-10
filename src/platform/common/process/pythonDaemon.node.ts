// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import { MessageConnection, RequestType, RequestType0 } from 'vscode-jsonrpc';
import { PythonExecInfo } from '../../pythonEnvironments/exec';
import { InterpreterInformation, PythonEnvironment } from '../../pythonEnvironments/info';
import { extractInterpreterInfo } from '../../pythonEnvironments/info/interpreter.node';
import { traceWarning } from '../../logging';
import { IPlatformService } from '../platform/types';
import { BasePythonDaemon, ConnectionClosedError, DaemonError } from './baseDaemon.node';
import { PythonEnvInfo } from './internal/scripts/index.node';
import {
    IPythonDaemonExecutionService,
    IPythonExecutionService,
    ObservableExecutionResult,
    SpawnOptions
} from './types.node';

type ErrorResponse = { error?: string };
/**
 * Daemon that is started as a python process. Uses a IPythonExecutionService to start daemon, which means it has the enviroment associated with an interpreter.
 */
export class PythonDaemonExecutionService extends BasePythonDaemon implements IPythonDaemonExecutionService {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(
        pythonExecutionService: IPythonExecutionService,
        platformService: IPlatformService,
        interpreter: PythonEnvironment,
        proc: ChildProcess,
        connection: MessageConnection
    ) {
        super(pythonExecutionService, platformService, interpreter, proc, connection);
    }
    public async getInterpreterInformation(): Promise<InterpreterInformation | undefined> {
        try {
            this.throwIfRPCConnectionIsDead();
            const request = new RequestType0<PythonEnvInfo & ErrorResponse, void>('get_interpreter_information');
            const response = await this.sendRequestWithoutArgs(request);
            if (response.error) {
                throw Error(response.error);
            }
            return extractInterpreterInfo(this.interpreter.uri, response);
        } catch (ex) {
            traceWarning('Falling back to Python Execution Service due to failure in daemon', ex);
            return this.pythonExecutionService.getInterpreterInformation();
        }
    }
    public async getExecutablePath(): Promise<string> {
        try {
            this.throwIfRPCConnectionIsDead();
            type ExecutablePathResponse = ErrorResponse & { path: string };
            const request = new RequestType0<ExecutablePathResponse, void>('get_executable');
            const response = await this.sendRequestWithoutArgs(request);
            if (response.error) {
                throw new DaemonError(response.error);
            }
            return response.path;
        } catch (ex) {
            traceWarning('Falling back to Python Execution Service due to failure in daemon', ex);
            return this.pythonExecutionService.getExecutablePath();
        }
    }
    public getExecutionInfo(pythonArgs?: string[]): PythonExecInfo {
        return this.pythonExecutionService.getExecutionInfo(pythonArgs);
    }
    public async isModuleInstalled(moduleName: string): Promise<boolean> {
        try {
            this.throwIfRPCConnectionIsDead();
            type ModuleInstalledResponse = ErrorResponse & { exists: boolean };
            const request = new RequestType<{ module_name: string }, ModuleInstalledResponse, void>(
                'is_module_installed'
            );
            const response = await this.sendRequest(request, { module_name: moduleName });
            if (response.error) {
                throw new DaemonError(response.error);
            }
            return response.exists;
        } catch (ex) {
            traceWarning('Falling back to Python Execution Service due to failure in daemon', ex);
            return this.pythonExecutionService.isModuleInstalled(moduleName);
        }
    }
    public override execObservable(args: string[], options: SpawnOptions): ObservableExecutionResult<string> {
        if (this.isAlive && this.canExecFileUsingDaemon(args, options)) {
            try {
                return this.execAsObservable({ fileName: args[0] }, args.slice(1), options);
            } catch (ex) {
                if (ex instanceof DaemonError || ex instanceof ConnectionClosedError) {
                    traceWarning('Falling back to Python Execution Service due to failure in daemon', ex);
                    return this.pythonExecutionService.execObservable(args, options);
                } else {
                    throw ex;
                }
            }
        } else {
            return this.pythonExecutionService.execObservable(args, options);
        }
    }
    public override execModuleObservable(
        moduleName: string,
        args: string[],
        options: SpawnOptions
    ): ObservableExecutionResult<string> {
        if (this.isAlive && this.canExecModuleUsingDaemon(moduleName, args, options)) {
            try {
                return this.execAsObservable({ moduleName }, args, options);
            } catch (ex) {
                if (ex instanceof DaemonError || ex instanceof ConnectionClosedError) {
                    traceWarning('Falling back to Python Execution Service due to failure in daemon', ex);
                    return this.pythonExecutionService.execModuleObservable(moduleName, args, options);
                } else {
                    throw ex;
                }
            }
        } else {
            return this.pythonExecutionService.execModuleObservable(moduleName, args, options);
        }
    }
}
