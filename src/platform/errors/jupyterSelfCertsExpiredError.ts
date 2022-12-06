// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { BaseError } from './types';

/**
 * Error thrown when a jupyter server is using a self signed expired certificate. This can be expected and we should ask if they want to allow it anyway.
 *
 * Cause:
 * User is connecting to a server that is using a self signed certificate that is expired. Detected by looking for a specific error message when connecting.
 *
 * Handled by:
 * The URI entry box when picking a server. It should ask the user if they want to allow it anyway.
 */
export class JupyterSelfCertsExpiredError extends BaseError {
    constructor(message: string) {
        super('jupyterselfexpiredcert', message);
    }
    public static isSelfCertsExpiredError(err: Error) {
        return err.message.indexOf('reason: certificate has expired') >= 0;
    }
}
