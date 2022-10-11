// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { ChildProcess } from 'child_process';
import { MessageConnection, RequestType } from 'vscode-jsonrpc';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { traceWarning } from '../../logging';
import { IPlatformService } from '../platform/types';
import { BasePythonDaemon, ConnectionClosedError, DaemonError } from './baseDaemon.node';
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
