// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseError } from '../../platform/errors/types';

/**
 * Thrown when a 3rd party extension has trouble computing a jupyter server URI
 *
 * Cause:
 * 3rd party extension that implements the IJupyterUriProviderRegistration interface threw an exception when trying to translate
 * the id and handle they gave us into a URI. We ask when:
 * - User goes through the 3rd party quick pick for a URI
 * - On reload of the extension
 * - On timeout if the 3rd party indicated the URI should have a timeout.
 *
 * Handled by:
 * The URI entry box when picking a server. It should put up a dialog or input validation problem. If the error occurs later (like on timeout), it will be swallowed.
 */
export class RemoteJupyterServerUriProviderError extends BaseError {
    constructor(
        public readonly serverProviderHandle: { id: string; handle: string; extensionId: string },
        public readonly originalError: Error
    ) {
        super('remotejupyterserveruriprovider', originalError.message || originalError.toString());
    }
}
