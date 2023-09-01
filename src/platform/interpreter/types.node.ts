// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { ExecutionResult, ObservableExecutionResult, SpawnOptions } from '../common/process/types.node';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { Environment } from '../api/pythonApiTypes';

export type ExecutionFactoryCreationOptions = {
    resource?: Uri;
    interpreter: PythonEnvironment | Environment;
};

export type ExecutionFactoryCreateWithEnvironmentOptions = {
    resource?: Uri;
    interpreter: PythonEnvironment | Environment;
    allowEnvironmentFetchExceptions?: boolean;
};
export const IPythonExecutionFactory = Symbol('IPythonExecutionFactory');
export interface IPythonExecutionFactory {
    create(options: ExecutionFactoryCreationOptions): Promise<IPythonExecutionService>;
    createActivatedEnvironment(options: ExecutionFactoryCreateWithEnvironmentOptions): Promise<IPythonExecutionService>;
}
export const IPythonExecutionService = Symbol('IPythonExecutionService');

export interface IPythonExecutionService {
    isModuleInstalled(moduleName: string): Promise<boolean>;
    execObservable(args: string[], options: SpawnOptions): ObservableExecutionResult<string>;
    execModuleObservable(moduleName: string, args: string[], options: SpawnOptions): ObservableExecutionResult<string>;

    exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>>;
    execModule(moduleName: string, args: string[], options: SpawnOptions): Promise<ExecutionResult<string>>;
}
