// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PythonEnvironment } from '../pythonEnvironments/info';
import { BaseError } from './types';

/**
 * Error thrown when jupyter server fails to start
 */
export class JupyterConnectError extends BaseError {
    constructor(
        message: string,
        stderr: string | string,
        public readonly interpreter?: PythonEnvironment
    ) {
        super('jupyterconnection', message + (stderr ? `\n${stderr}` : ''));
    }
}
