// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { BaseError } from './types';

/**
 * Error thrown when a jupyter server is using an expired certificate. This can be expected and we should ask if they want to allow it anyway.
 */
export class JupyterExpiredCertsError extends BaseError {
    constructor(message: string) {
        super('jupyterexpiredcert', message);
    }
}
