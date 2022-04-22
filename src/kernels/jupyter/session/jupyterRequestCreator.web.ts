// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import * as WebSocketIsomorphic from 'isomorphic-ws';
import { ClassType } from '../../../platform/ioc/types';
import { traceError } from '../../../platform/logging';
import { KernelSocketWrapper } from '../../common/kernelSocketWrapper';
import { IKernelSocket } from '../../types';
import { IJupyterRequestCreator } from '../types';

const JupyterWebSockets = new Map<string, WebSocketIsomorphic & IKernelSocket>(); // NOSONAR

// Function for creating node Request object that prevents jupyterlab services from writing its own
// authorization header.
/* eslint-disable @typescript-eslint/no-explicit-any */
@injectable()
export class JupyterRequestCreator implements IJupyterRequestCreator {
    public getRequestCtor(getAuthHeader?: () => any) {
        class AuthorizingRequest extends Request {
            constructor(input: RequestInfo, init?: RequestInit) {
                super(input, init);

                // Add all of the authorization parts onto the headers.
                const origHeaders = this.headers;
                const authorizationHeader = getAuthHeader!();
                const keys = Object.keys(authorizationHeader);
                keys.forEach((k) => origHeaders.append(k, authorizationHeader[k].toString()));
                origHeaders.set('Content-Type', 'application/json');

                // Rewrite the 'append' method for the headers to disallow 'authorization' after this point
                const origAppend = origHeaders.append.bind(origHeaders);
                origHeaders.append = (k, v) => {
                    if (k.toLowerCase() !== 'authorization') {
                        origAppend(k, v);
                    }
                };
            }
        }

        return getAuthHeader ? AuthorizingRequest : Request;
    }

    public getWebsocketCtor(cookieString?: string, allowUnauthorized?: boolean, getAuthHeaders?: () => any) {
        class JupyterWebSocket extends KernelSocketWrapper(WebSocketIsomorphic) {
            private kernelId: string | undefined;
            private timer: NodeJS.Timeout | number;

            constructor(url: string, protocols?: string | string[] | undefined) {
                let co = {};
                let co_headers: { [key: string]: string } | undefined;

                if (allowUnauthorized) {
                    co = { ...co, rejectUnauthorized: false };
                }

                if (cookieString) {
                    co_headers = { Cookie: cookieString };
                }

                // Auth headers have to be refetched every time we create a connection. They may have expired
                // since the last connection.
                if (getAuthHeaders) {
                    const authorizationHeader = getAuthHeaders();
                    co_headers = co_headers ? { ...co_headers, ...authorizationHeader } : authorizationHeader;
                }
                if (co_headers) {
                    co = { ...co, headers: co_headers };
                    console.log(`CO Headers: ${co}`);
                }

                super(url, protocols);

                // TODO: How to send auth headers? Try debugging this to see what happens.

                let timer: NodeJS.Timeout | undefined = undefined;
                // Parse the url for the kernel id
                const parsed = /.*\/kernels\/(.*)\/.*/.exec(url);
                if (parsed && parsed.length > 1) {
                    this.kernelId = parsed[1];
                }
                if (this.kernelId) {
                    JupyterWebSockets.set(this.kernelId, this);
                    this.onclose = () => {
                        if (timer && this.timer !== timer) {
                            clearInterval(timer as any);
                        }
                        if (JupyterWebSockets.get(this.kernelId!) === this) {
                            JupyterWebSockets.delete(this.kernelId!);
                        }
                    };
                } else {
                    traceError('KernelId not extracted from Kernel WebSocket URL');
                }

                // Ping the websocket connection every 30 seconds to make sure it stays alive
                timer = this.timer = setInterval(() => this.ping(), 30_000);
            }
        }
        return JupyterWebSocket as any;
    }

    public getWebsocket(id: string): IKernelSocket | undefined {
        return JupyterWebSockets.get(id);
    }

    public getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
        return fetch;
    }

    public getHeadersCtor(): ClassType<Headers> {
        return Headers;
    }

    public getRequestInit(): RequestInit {
        return { cache: 'no-store' };
    }
}
