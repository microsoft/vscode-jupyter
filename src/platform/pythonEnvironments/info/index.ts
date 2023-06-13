// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


import { Uri } from 'vscode';
import { PythonVersion } from './pythonVersion';

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
 * @prop sysVersion - the raw value of `sys.version`
 * @prop sysPrefix - the environment's install root (`sys.prefix`)
 */
export type InterpreterInformation = {
    id: InterpreterId;
    uri: Uri;
    version?: PythonVersion;
    sysVersion?: string;
    sysPrefix?: string;
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
    isCondaEnvWithoutPython?: boolean;
};
