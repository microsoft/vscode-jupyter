// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';
import { PythonEnvironmentV2 } from '../api/types';
import { PythonEnvironment } from '../pythonEnvironments/info';

export const IInterpreterService = Symbol('IInterpreterService');
export interface IInterpreterService {
    readonly status: 'refreshing' | 'idle';
    readonly onDidChangeStatus: Event<void>;
    /**
     * Contains details of all the currently discovered Python Environments along with all of their resolved information.
     */
    readonly resolvedEnvironments: PythonEnvironment[];
    readonly environments: readonly PythonEnvironmentV2[];
    waitForAllInterpretersToLoad(): Promise<void>;
    onDidChangeInterpreter: Event<void>;
    onDidChangeInterpreters: Event<void>;
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
    ): Promise<undefined | PythonEnvironment>;
    getInterpreterHash(id: string): string | undefined;
}
