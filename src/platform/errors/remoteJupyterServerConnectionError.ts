// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

/**
 * Generic error for any problem with connecting to a remote jupyter server
 */
export class RemoteJupyterServerConnectionError extends BaseError {
    public readonly baseUrl: string;
    constructor(url: string, public readonly serverId: string, public readonly originalError: Error) {
        super(
            'remotejupyterserverconnection',
            DataScience.remoteJupyterConnectionFailedWithServerWithError().format(
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
