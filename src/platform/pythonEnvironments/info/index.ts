// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


import { Uri } from 'vscode';

/**
 * The supported Python environment types.
 */
export enum EnvironmentType {
    Unknown = 'Unknown',
    Conda = 'Conda',
    VirtualEnv = 'VirtualEnv',
    Pipenv = 'PipEnv',
    Pyenv = 'Pyenv',
    Venv = 'Venv',
    Poetry = 'Poetry',
    VirtualEnvWrapper = 'VirtualEnvWrapper',
}

/**
 * Details about a Python environment.
 */
export interface PythonEnvironment {
    id: string;
    uri: Uri;
}
