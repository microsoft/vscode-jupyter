// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri, CancellationToken } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { Environment, ResolvedEnvironment } from '@vscode/python-extension';
type InterpreterId = string;
export const IInterpreterService = Symbol('IInterpreterService');
export interface IInterpreterService {
    // #region New API
    resolveEnvironment(id: string | Environment): Promise<ResolvedEnvironment | undefined>;
    // #endregion

    // #region Old API
    readonly status: 'refreshing' | 'idle';
    readonly onDidChangeStatus: Event<void>;
    readonly onDidEnvironmentVariablesChange: Event<void>;
    onDidChangeInterpreter: Event<PythonEnvironment | undefined>;
    onDidChangeInterpreters: Event<PythonEnvironment[]>;
    onDidRemoveInterpreter: Event<{ id: string }>;
    refreshInterpreters(forceRefresh?: boolean): Promise<void>;
    getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined>;
    /**
     * Gets the details of a Python Environment
     * @param pythonPath Absolute path to the python executable or the path to the Environment as {path: string}.
     */
    getInterpreterDetails(
        pythonPath:
            | Uri
            | {
                  /** Environment Path */
                  path: string;
              }
            | InterpreterId,
        token?: CancellationToken
    ): Promise<undefined | PythonEnvironment>;
    getInterpreterHash(id: string): string | undefined;
    // #endregion
}
