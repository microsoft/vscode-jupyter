// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from './types';

/**
 * Error thrown when a jupyter server is using an self signed certificate. This can be expected and we should ask if they want to allow it anyway.
 */
export class JupyterSelfCertsError extends BaseError {
    constructor(message: string) {
        super('jupyterselfcert', message);
    }
    public static isSelfCertsError(err: Error) {
        return err.message.indexOf('reason: self signed certificate') >= 0;
    }
}
