// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IHttpClient } from '../types';
import { traceVerbose } from '../../logging';
import * as fetch from 'cross-fetch';
import { workspace } from 'vscode';

/**
 * Class used to verify http connections and make GET requests
 */
export class HttpClient implements IHttpClient {
    private readonly requestOptions: RequestInit = {};
    constructor(private readonly fetchImplementation: typeof fetch.fetch = fetch.fetch) {
        const proxy = workspace.getConfiguration('http').get('proxy', '');
        if (proxy) {
            this.requestOptions = { headers: { proxy } };
        }
    }

    public async downloadFile(uri: string): Promise<Response> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.fetchImplementation(uri, this.requestOptions);
    }

    public async exists(uri: string): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        try {
            const response = await this.downloadFile(uri);
            return response.status === 200;
        } catch (ex) {
            traceVerbose(`HttpClient - Failure checking for file ${uri}: ${ex}`);
            return false;
        }
    }
}
