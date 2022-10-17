// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';

export const IInterpreterService = Symbol('IInterpreterService');
export interface IInterpreterService {
    /**
     * Contains details of all the currently discovered Python Environments along with all of their resolved information.
     */
    readonly resolvedEnvironments: PythonEnvironment[];
    onDidChangeInterpreter: Event<void>;
    onDidChangeInterpreters: Event<void>;
    refreshInterpreters(forceRefresh?: boolean): Promise<void>;
    getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined>;
    getInterpreterDetails(pythonPath: Uri): Promise<undefined | PythonEnvironment>;
}
