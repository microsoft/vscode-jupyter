// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../platform/errors/types';

/**
 * Thrown when an extension gives us an invalid handle for a Jupyter server
 */
export class InvalidRemoteJupyterServerUriHandleError extends BaseError {
    constructor(
        public readonly providerId: string,
        public readonly handle: string,
        public readonly extensionId: string,
        public readonly serverId: string
    ) {
        super('invalidremotejupyterserverurihandle', 'Server handle not in list of known handles');
    }
}
