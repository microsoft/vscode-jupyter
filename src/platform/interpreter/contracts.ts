// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';

export const IInterpreterService = Symbol('IInterpreterService');
export interface IInterpreterService {
    onDidChangeInterpreter: Event<void>;
    onDidChangeInterpreters: Event<void>;
    refreshInterpreters(): Promise<void>;
    getInterpreters(resource?: Uri): Promise<PythonEnvironment[]>;
    getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined>;
    getInterpreterDetails(pythonPath: Uri, resource?: Uri): Promise<undefined | PythonEnvironment>;
    refreshing: boolean;
}
