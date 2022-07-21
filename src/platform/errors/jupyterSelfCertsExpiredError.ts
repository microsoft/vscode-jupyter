// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from './types';

/**
 * Error thrown when a jupyter server is using a self signed expired certificate. This can be expected and we should ask if they want to allow it anyway.
 */
export class JupyterSelfCertsExpiredError extends BaseError {
    constructor(message: string) {
        super('jupyterselfexpiredcert', message);
    }
    public static isSelfCertsExpiredError(err: Error) {
        return err.message.indexOf('reason: certificate has expired') >= 0;
    }
}
