// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { BaseError } from '../../platform/errors/types';

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
