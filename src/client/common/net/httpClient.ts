// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { parse, ParseError } from 'jsonc-parser';
import type * as requestTypes from 'request';
import { IHttpClient } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { IWorkspaceService } from '../application/types';
import { traceError } from '../logger';

@injectable()
export class HttpClient implements IHttpClient {
    public readonly requestOptions: requestTypes.CoreOptions;
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        this.requestOptions = { proxy: workspaceService.getConfiguration('http').get('proxy', '') };
    }

    public async downloadFile(uri: string): Promise<requestTypes.Request> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const request = ((await import('request')) as any) as typeof requestTypes;
        return request(uri, this.requestOptions);
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
        const request = require('request') as typeof requestTypes;
        return new Promise<boolean>((resolve) => {
            try {
                request
                    .get(uri, this.requestOptions)
                    .on('response', (response) => resolve(response.statusCode === 200))
                    .on('error', () => resolve(false));
            } catch {
                resolve(false);
            }
        });
    }
    private async getContents(uri: string): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const request = require('request') as typeof requestTypes;
        return new Promise<string>((resolve, reject) => {
            request(uri, this.requestOptions, (ex, response, body) => {
                if (ex) {
                    return reject(ex);
                }
                if (response.statusCode !== 200) {
                    return reject(
                        new Error(`Failed with status ${response.statusCode}, ${response.statusMessage}, Uri ${uri}`)
                    );
                }
                resolve(body);
            });
        });
    }
}
