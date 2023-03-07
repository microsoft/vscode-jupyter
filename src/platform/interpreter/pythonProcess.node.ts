// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PythonExecInfo } from '../pythonEnvironments/exec';
import { ErrorUtils } from '../errors/errorUtils';
import { ModuleNotInstalledError } from '../errors/moduleNotInstalledError';
import * as internalPython from '../interpreter/internal/python.node';
import {
    SpawnOptions,
    ExecutionResult,
    ObservableExecutionResult,
    IProcessService
} from '../common/process/types.node';

/**
 * IProcessService (like) that is python based. Starting arg isn't necessary when python is used.
 */
class PythonProcessService {
    constructor(
        // This is the externally defined functionality used by the class.
        private readonly deps: {
            // from PythonEnvironment:
            isModuleInstalled(moduleName: string): Promise<boolean>;
            getExecutionInfo(pythonArgs?: string[]): PythonExecInfo;
            getExecutionObservableInfo(pythonArgs?: string[]): PythonExecInfo;
            // from ProcessService:
            exec(file: string, args: string[], options: SpawnOptions): Promise<ExecutionResult<string>>;
            execObservable(file: string, args: string[], options: SpawnOptions): ObservableExecutionResult<string>;
        }
    ) {}

    public execObservable(args: string[], options: SpawnOptions): ObservableExecutionResult<string> {
        const opts: SpawnOptions = { ...options };
        const executable = this.deps.getExecutionObservableInfo(args);
        return this.deps.execObservable(executable.command, executable.args, opts);
    }

    public execModuleObservable(
        moduleName: string,
        moduleArgs: string[],
        options: SpawnOptions
    ): ObservableExecutionResult<string> {
        const args = internalPython.execModule(moduleName, moduleArgs);
        const opts: SpawnOptions = { ...options };
        const executable = this.deps.getExecutionObservableInfo(args);
        // We should never set token for long running processes.
        // We don't want the process to die when the token is cancelled.
        const spawnOptions = { ...options };
        spawnOptions.token = undefined;
        return this.deps.execObservable(executable.command, executable.args, opts);
    }

    public async exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>> {
        const opts: SpawnOptions = { ...options };
        const executable = this.deps.getExecutionInfo(args);
        return this.deps.exec(executable.command, executable.args, opts);
    }

    public async execModule(
        moduleName: string,
        moduleArgs: string[],
        options: SpawnOptions
    ): Promise<ExecutionResult<string>> {
        const args = internalPython.execModule(moduleName, moduleArgs);
        const opts: SpawnOptions = { ...options };
        const executable = this.deps.getExecutionInfo(args);
        const result = await this.deps.exec(executable.command, executable.args, opts);

        // If a module is not installed we'll have something in stderr.
        if (moduleName && ErrorUtils.outputHasModuleNotInstalledError(moduleName, result.stderr)) {
            const isInstalled = await this.deps.isModuleInstalled(moduleName);
            if (!isInstalled) {
                throw new ModuleNotInstalledError(moduleName);
            }
        }

        return result;
    }
}

export function createPythonProcessService(
    procs: IProcessService,
    // from PythonEnvironment:
    env: {
        getExecutionInfo(pythonArgs?: string[]): PythonExecInfo;
        getExecutionObservableInfo(pythonArgs?: string[]): PythonExecInfo;
        isModuleInstalled(moduleName: string): Promise<boolean>;
    }
) {
    const deps = {
        // from PythonService:
        isModuleInstalled: async (m: string) => env.isModuleInstalled(m),
        getExecutionInfo: (a?: string[]) => env.getExecutionInfo(a),
        getExecutionObservableInfo: (a?: string[]) => env.getExecutionObservableInfo(a),
        // from ProcessService:
        exec: async (f: string, a: string[], o: SpawnOptions) => procs.exec(f, a, o),
        execObservable: (f: string, a: string[], o: SpawnOptions) => procs.execObservable(f, a, o)
    };
    return new PythonProcessService(deps);
}
