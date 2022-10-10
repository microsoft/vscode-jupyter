// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { buildPythonExecInfo, PythonExecInfo } from '../../pythonEnvironments/exec';
import { getExecutablePath } from '../../pythonEnvironments/info/executable.node';
import * as internalPython from './internal/python.node';
import { ExecutionResult, IProcessService, ShellOptions, SpawnOptions } from './types.node';
import { compare, SemVer } from 'semver';
import type { PythonEnvironment as PyEnv } from '../../pythonEnvironments/info';
import { getFilePath } from '../platform/fs-paths';
import { Uri } from 'vscode';
import { IFileSystem } from '../platform/types';
class PythonEnvironment {
    constructor(
        protected readonly interpreter: PyEnv,
        // "deps" is the externally defined functionality used by the class.
        protected readonly deps: {
            getPythonArgv(python: Uri): string[];
            getObservablePythonArgv(python: Uri): string[];
            isValidExecutable(python: Uri): Promise<boolean>;
            // from ProcessService:
            exec(file: string, args: string[]): Promise<ExecutionResult<string>>;
            shellExec(command: string, timeout: number): Promise<ExecutionResult<string>>;
        }
    ) {}

    public getExecutionInfo(pythonArgs: string[] = []): PythonExecInfo {
        const python = this.deps.getPythonArgv(this.interpreter.uri);
        return buildPythonExecInfo(python, pythonArgs);
    }
    public getExecutionObservableInfo(pythonArgs: string[] = []): PythonExecInfo {
        const python = this.deps.getObservablePythonArgv(this.interpreter.uri);
        return buildPythonExecInfo(python, pythonArgs);
    }
    public async getExecutablePath(): Promise<Uri> {
        // If we've passed the python file, then return the file.
        // This is because on mac if using the interpreter /usr/bin/python2.7 we can get a different value for the path
        if (await this.deps.isValidExecutable(this.interpreter.uri)) {
            return this.interpreter.uri;
        }
        const python = this.getExecutionInfo();
        return getExecutablePath(python, this.deps.exec);
    }

    public async isModuleInstalled(moduleName: string): Promise<boolean> {
        // prettier-ignore
        const [args,] = internalPython.isModuleInstalled(moduleName);
        const info = this.getExecutionInfo(args);
        try {
            await this.deps.exec(info.command, info.args);
        } catch {
            return false;
        }
        return true;
    }
}

function createDeps(
    isValidExecutable: (filename: Uri) => Promise<boolean>,
    pythonArgv: string[] | undefined,
    observablePythonArgv: string[] | undefined,
    // from ProcessService:
    exec: (file: string, args: string[], options?: SpawnOptions) => Promise<ExecutionResult<string>>,
    shellExec: (command: string, options?: ShellOptions) => Promise<ExecutionResult<string>>
) {
    return {
        getPythonArgv: (python: Uri) => pythonArgv || [getFilePath(python)],
        getObservablePythonArgv: (python: Uri) => observablePythonArgv || [getFilePath(python)],
        isValidExecutable,
        exec: async (cmd: string, args: string[]) => exec(cmd, args, { throwOnStdErr: true }),
        shellExec: async (text: string, timeout: number) => shellExec(text, { timeout })
    };
}

export function createPythonEnv(
    interpreter: PyEnv,
    // These are used to generate the deps.
    procs: IProcessService,
    fs: IFileSystem
): PythonEnvironment {
    const deps = createDeps(
        async (filename: Uri) => fs.exists(filename),
        // We use the default: [pythonPath].
        undefined,
        undefined,
        (file, args, opts) => procs.exec(file, args, opts),
        (command, opts) => procs.shellExec(command, opts)
    );
    return new PythonEnvironment(interpreter, deps);
}

export function condaVersionSupportsLiveStreaming(version?: SemVer): boolean {
    if (!version) {
        return false;
    }
    return compare(version.raw, '4.9.0') >= 0;
}
export function createCondaEnv(
    condaFile: string,
    condaInfo: {
        name: string;
        path: string;
        version?: SemVer;
    },
    interpreter: PyEnv,
    // These are used to generate the deps.
    procs: IProcessService,
    fs: IFileSystem
): PythonEnvironment {
    const runArgs = ['run'];
    if (condaInfo.name === '') {
        runArgs.push('-p', condaInfo.path);
    } else {
        runArgs.push('-n', condaInfo.name);
    }
    const pythonArgv = [condaFile, ...runArgs, 'python'];
    const deps = createDeps(
        async (filename) => fs.exists(filename),
        pythonArgv,
        // eslint-disable-next-line
        // TODO: Use pythonArgv here once 'conda run' can be
        // run without buffering output.
        // See https://github.com/microsoft/vscode-python/issues/8473.
        undefined,
        (file, args, opts) => procs.exec(file, args, opts),
        (command, opts) => procs.shellExec(command, opts)
    );
    return new PythonEnvironment(interpreter, deps);
}
