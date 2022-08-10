// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { Uri } from 'vscode';
import { PythonVersion } from './pythonVersion';

type ReleaseLevel = 'alpha' | 'beta' | 'candidate' | 'final' | 'unknown';

/**
 * The components of a Python version.
 *
 * These match the elements of `sys.version_info`.
 */
export type PythonVersionInfo = [number, number, number, ReleaseLevel];

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
    WindowsStore = 'WindowsStore',
    Poetry = 'Poetry',
    VirtualEnvWrapper = 'VirtualEnvWrapper',
    Global = 'Global',
    System = 'System',
}

/**
 * Details about a Python runtime.
 *
 * @prop path - the location of the executable file
 * @prop version - the runtime version
 * @prop sysVersion - the raw value of `sys.version`
 * @prop sysPrefix - the environment's install root (`sys.prefix`)
 */
export type InterpreterInformation = {
    uri: Uri;
    version?: PythonVersion;
    sysVersion?: string;
    sysPrefix: string;
};

/**
 * Details about a Python environment.
 * @prop envType - the kind of Python environment
 */
export type PythonEnvironment = InterpreterInformation & {
    displayName?: string;
    envType?: EnvironmentType;
    envName?: string;
    envPath?: Uri;
};
