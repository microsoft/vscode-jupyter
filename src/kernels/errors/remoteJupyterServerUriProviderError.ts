// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computeServerId, generateUriFromRemoteProvider } from '../jupyter/jupyterUtils';
import { BaseError } from '../../platform/errors/types';

export class RemoteJupyterServerUriProviderError extends BaseError {
    public readonly serverId: string;
    constructor(
        public readonly providerId: string,
        public readonly handle: string,
        public readonly originalError: Error
    ) {
        super('remotejupyterserveruriprovider', originalError.message || originalError.toString());
        this.serverId = computeServerId(generateUriFromRemoteProvider(providerId, handle));
    }
}
