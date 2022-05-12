// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computeServerId, generateUriFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { BaseError } from './types';

export class InvalidRemoteJupyterServerUriHandleError extends BaseError {
    public readonly serverId: string;
    constructor(
        public readonly providerId: string,
        public readonly handle: string,
        public readonly extensionId: string
    ) {
        super('invalidremotejupyterserverurihandle', 'Server handle not in list of known handles');
        this.serverId = computeServerId(generateUriFromRemoteProvider(providerId, handle));
    }
}
