// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IHttpClient } from '../types';
import { IWorkspaceService } from '../application/types';
import { traceVerbose } from '../../logging';
import * as fetch from 'cross-fetch';

/**
 * Class used to verify http connections and make GET requests
 */
@injectable()
export class HttpClient implements IHttpClient {
    public readonly requestOptions: RequestInit = {};
    constructor(@inject(IWorkspaceService) workspaceService: IWorkspaceService) {
        const proxy = workspaceService.getConfiguration('http').get('proxy', '');
        if (proxy) {
            this.requestOptions = { headers: { proxy } };
        }
    }

    public async downloadFile(uri: string): Promise<Response> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return fetch.fetch(uri, this.requestOptions);
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
