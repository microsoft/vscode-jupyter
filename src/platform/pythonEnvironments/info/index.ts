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
 * Details about a Python runtime.
 *
 * @prop path - the location of the executable file
 * @prop version - the runtime version
 * @prop sysPrefix - the environment's install root (`sys.prefix`)
 */
export type InterpreterInformation = {
    id: InterpreterId;
    uri: Uri;
};

/**
 * Details about a Python environment.
 * @prop envType - the kind of Python environment
 */
export type PythonEnvironment = InterpreterInformation & {
    displayName?: string;
    envType?: EnvironmentType;
    envName?: string;
    /**
     * Directory of the Python environment.
     */
    envPath?: Uri;
    /**
     * This contains the path to the environment.
     * Used for display purposes only (in kernel picker or other places).
     */
    displayPath?: Uri;
    isCondaEnvWithoutPython?: boolean;
};
