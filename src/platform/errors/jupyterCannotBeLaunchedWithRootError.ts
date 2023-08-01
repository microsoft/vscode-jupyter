// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PythonEnvironment } from '../pythonEnvironments/info';
import { BaseError } from './types';

/**
 * Error thrown when Jupyter Notebook cannot be launched as `root`.
 * The error output from Jupyter Notebook is as follows
 * ```
 * [C 02:48:09.471 NotebookApp] Running as root is not recommended. Use --allow-root to bypass.
 * ```
 */
export class JupyterCannotBeLaunchedWithRootError extends BaseError {
    constructor(
        message: string,
        stderr: string | string,
        public readonly interpreter?: PythonEnvironment
    ) {
        super('jupytercannotbelaunchedwitheroot', message + (stderr ? `\n${stderr}` : ''));
    }
}
