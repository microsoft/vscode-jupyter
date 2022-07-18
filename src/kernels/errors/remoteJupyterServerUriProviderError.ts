// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { BaseError } from '../../platform/errors/types';

/**
 * Thrown when a 3rd party extension has trouble computing a jupyter server URI
 */
export class RemoteJupyterServerUriProviderError extends BaseError {
    constructor(
        public readonly providerId: string,
        public readonly handle: string,
        public readonly originalError: Error,
        public serverId: string
    ) {
        super('remotejupyterserveruriprovider', originalError.message || originalError.toString());
    }
}
