// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { SemVer } from 'semver';

import { ErrorUtils } from '../../platform/errors/errorUtils';
import { ModuleNotInstalledError } from '../../platform/errors/moduleNotInstalledError';
import { ProcessService } from '../../platform/common/process/proc.node';
import {
    ExecutionResult,
    IPythonExecutionService,
    ObservableExecutionResult,
    SpawnOptions
} from '../../platform/common/process/types.node';
import { buildPythonExecInfo } from '../../platform/pythonEnvironments/exec';
import { InterpreterInformation } from '../../platform/pythonEnvironments/info';
import { Uri } from 'vscode';

export class MockPythonExecutionService implements IPythonExecutionService {
    private procService: ProcessService;
    private pythonPath: string = 'python';

    constructor() {
        this.procService = new ProcessService();
    }

    public getInterpreterInformation(): Promise<InterpreterInformation> {
        return Promise.resolve({
            uri: Uri.file(''),
            version: new SemVer('3.6.0-beta'),
            sysVersion: '1.0',
            sysPrefix: '1.0'
        });
    }

    public getExecutablePath(): Promise<string> {
        return Promise.resolve(this.pythonPath);
    }
    public isModuleInstalled(moduleName: string): Promise<boolean> {
        return this.procService
            .exec(this.pythonPath, ['-c', `import ${moduleName}`], { throwOnStdErr: true })
            .then(() => true)
            .catch(() => false);
    }
    public execObservable(args: string[], options: SpawnOptions): ObservableExecutionResult<string> {
        const opts: SpawnOptions = { ...options };
        return this.procService.execObservable(this.pythonPath, args, opts);
    }
    public execModuleObservable(
        moduleName: string,
        args: string[],
        options: SpawnOptions
    ): ObservableExecutionResult<string> {
        const opts: SpawnOptions = { ...options };
        return this.procService.execObservable(this.pythonPath, ['-m', moduleName, ...args], opts);
    }
    public exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>> {
        const opts: SpawnOptions = { ...options };
        return this.procService.exec(this.pythonPath, args, opts);
    }
    public async execModule(
        moduleName: string,
        args: string[],
        options: SpawnOptions
    ): Promise<ExecutionResult<string>> {
        const opts: SpawnOptions = { ...options };
        const result = await this.procService.exec(this.pythonPath, ['-m', moduleName, ...args], opts);

        // If a module is not installed we'll have something in stderr.
        if (moduleName && ErrorUtils.outputHasModuleNotInstalledError(moduleName!, result.stderr)) {
            const isInstalled = await this.isModuleInstalled(moduleName!);
            if (!isInstalled) {
                throw new ModuleNotInstalledError(moduleName!);
            }
        }

        return result;
    }
    public getExecutionInfo(args: string[]) {
        return buildPythonExecInfo(this.pythonPath, args);
    }
}
