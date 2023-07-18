// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseError } from '../../platform/errors/types';

/**
 * Thrown when an extension gives us an invalid handle for a Jupyter server
 *
 * Cause:
 * The IJupyterUriProvider getHandles call returns a list of handles that doesn't include the handle we asked for.
 * This would likely be an error in the 3rd party extension.
 *
 * Handled by:
 * The URI entry box when picking a server. It should put up a dialog or input validation problem. If the error occurs later (like on timeout), it will be swallowed.
 */
export class InvalidRemoteJupyterServerUriHandleError extends BaseError {
    constructor(
        public readonly serverProviderHandle: { id: string; handle: string },
        public readonly extensionId: string
    ) {
        super('invalidremotejupyterserverurihandle', 'Server handle not in list of known handles');
    }
}
