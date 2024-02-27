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

export type InterpreterId = string;

/**
 * Details about a Python environment.
 */
export interface PythonEnvironment {
    id: InterpreterId;
    uri: Uri;
    displayName?: string;
    /**
     * This contains the path to the environment.
     * Used for display purposes only (in kernel picker or other places).
     */
    displayPath?: Uri;
};
