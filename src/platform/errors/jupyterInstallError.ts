// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { BaseError } from './types';

/**
 * Error thrown when we can't run jupyter
 *
 * Cause:
 * Number of reasons:
 * - Python isn't installed
 * - Jupyter isn't installed in the interpreter tried (there's only one)
 *
 * Handled by:
 * KernelErrorHandler uses this to figure out it needs to tell the user to install jupyter. It will show a message in the cell.
 */
export class JupyterInstallError extends BaseError {
    constructor(message: string) {
        super('jupyterinstall', message);
    }
}
