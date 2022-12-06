// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { BaseError } from './types';

/**
 * Error thrown when jupyter server fails to start
 */
export class JupyterConnectError extends BaseError {
    constructor(message: string, stderr?: string) {
        super('jupyterconnection', message + (stderr ? `\n${stderr}` : ''));
    }
}
