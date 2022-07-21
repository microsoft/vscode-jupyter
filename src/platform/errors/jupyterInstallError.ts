// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from './types';

/**
 * Error thrown when we can't install the jupyter package into an environment.
 */
export class JupyterInstallError extends BaseError {
    constructor(message: string) {
        super('jupyterinstall', message);
    }
}
