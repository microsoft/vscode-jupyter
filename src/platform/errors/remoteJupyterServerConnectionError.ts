// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

/**
 * Generic error for any problem with connecting to a remote jupyter server
 *
 * Cause:
 * Some problem when trying to connect to a remote jupyter server. Could be a 403 error, could be a CORS header problem.
 *
 * Handled by:
 * The URI entry box when picking a server. It should disallow the user from picking the URI.
 * Can also happen on reconnection. In that case it should postpone the error until the user runs a cell.
 */
export class RemoteJupyterServerConnectionError extends BaseError {
    public readonly baseUrl: string;
    constructor(
        readonly url: string,
        public readonly serverProviderHandle: { id: string; handle: string },
        public readonly originalError: Error
    ) {
        super(
            'remotejupyterserverconnection',
            DataScience.remoteJupyterConnectionFailedWithServerWithError(
                getBaseUrl(url),
                originalError.message || originalError.toString()
            )
        );
        this.baseUrl = getBaseUrl(url);
    }
}

function getBaseUrl(url: string) {
    const uri = new URL(url);
    return `${uri.protocol}//${uri.host}/`;
}
