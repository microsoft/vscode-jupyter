// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri, CancellationToken } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';
type InterpreterId = string;
export const IInterpreterService = Symbol('IInterpreterService');
export interface IInterpreterService {
    readonly status: 'refreshing' | 'idle';
    readonly onDidChangeStatus: Event<void>;
    readonly onDidEnvironmentVariablesChange: Event<void>;
    /**
     * Contains details of all the currently discovered Python Environments along with all of their resolved information.
     */
    readonly resolvedEnvironments: PythonEnvironment[];
    readonly environmentsFound: boolean;
    /**
     * Pause detection of Python environments until the token is cancelled.
     * After the token is cancelled, detection will resume and pending events will be triggered.
     */
    pauseInterpreterDetection(cancelToken: CancellationToken): void;
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
}
