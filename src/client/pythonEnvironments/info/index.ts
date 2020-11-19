// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

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
    Conda = 'Conda',
}

/**
 * Details about a Python runtime.
 *
 * @prop path - the location of the executable file
 * @prop version - the runtime version
 * @prop sysVersion - the raw value of `sys.version`
 * @prop sysPrefix - the environment's install root (`sys.prefix`)
 * @prop envType - the kind of Python environment
 */
export type InterpreterInformation = {
    path: string;
    version?: PythonVersion;
    sysVersion?: string;
    sysPrefix: string;
    envType?: EnvironmentType;
};

/**
 * Details about a Python environment.
 */
export type PythonEnvironment = InterpreterInformation & {
    displayName?: string;
};
