// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { parse, ParseError } from 'jsonc-parser';
import { IHttpClient } from '../types';
import { IServiceContainer } from '../../ioc/types';
import { IWorkspaceService } from '../application/types';
import { traceError } from '../../logging';
import * as fetch from 'cross-fetch';

@injectable()
export class HttpClient implements IHttpClient {
    public readonly requestOptions: RequestInit;
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        this.requestOptions = { headers: { proxy: workspaceService.getConfiguration('http').get('proxy', '') } };
    }

    public async downloadFile(uri: string): Promise<Response> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return fetch.fetch(uri, this.requestOptions);
    }

    public async getJSON<T>(uri: string, strict: boolean = true): Promise<T> {
        const body = await this.getContents(uri);
        return this.parseBodyToJSON(body, strict);
    }

    public async parseBodyToJSON<T>(body: string, strict: boolean): Promise<T> {
        if (strict) {
            return JSON.parse(body);
        } else {
            // eslint-disable-next-line prefer-const
            let errors: ParseError[] = [];
            const content = parse(body, errors, { allowTrailingComma: true, disallowComments: false }) as T;
            if (errors.length > 0) {
                traceError('JSONC parser returned ParseError codes', errors);
            }
            return content;
        }
    }

    public async exists(uri: string): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        try {
            const response = await this.downloadFile(uri);
            return response.status === 200;
        } catch {
            return false;
        }
    }
    private async getContents(uri: string): Promise<string> {
        const response = await this.downloadFile(uri);
        if (response.status === 200) {
            return response.text();
        } else {
            throw new Error(response.statusText);
        }
    }
}
