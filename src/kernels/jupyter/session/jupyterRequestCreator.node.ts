// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IJupyterRequestCreator } from '../types';
import * as nodeFetch from 'node-fetch';
import { ClassType } from '../../../platform/ioc/types';
import WebSocketIsomorphic from 'isomorphic-ws';
import { traceError } from '../../../platform/logging';
import { noop } from '../../../platform/common/utils/misc';
import { KernelSocketWrapper } from '../../common/kernelSocketWrapper';
import { IKernelSocket } from '../../types';
import { injectable } from 'inversify';

/* eslint-disable @typescript-eslint/no-explicit-any */
const JupyterWebSockets = new Map<string, WebSocketIsomorphic & IKernelSocket>(); // NOSONAR

// Function for creating node Request object that prevents jupyterlab services from writing its own
// authorization header.
/* eslint-disable @typescript-eslint/no-explicit-any */
@injectable()
export class JupyterRequestCreator implements IJupyterRequestCreator {
    public getRequestCtor(_cookieString?: string, _allowUnauthorized?: boolean, getAuthHeader?: () => any) {
        // Only need the authorizing part. Cookie and rejectUnauthorized are set in the websocket ctor for node.
        class AuthorizingRequest extends nodeFetch.Request {
            constructor(input: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit) {
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

        return (getAuthHeader ? AuthorizingRequest : nodeFetch.Request) as any;
    }

    public getWebsocketCtor(
        cookieString?: string,
        allowUnauthorized?: boolean,
        getAuthHeaders?: () => any
    ): ClassType<WebSocket> {
        class JupyterWebSocket extends KernelSocketWrapper(WebSocketIsomorphic) {
            private kernelId: string | undefined;
            private timer: NodeJS.Timeout | number;

            constructor(url: string, protocols?: string | string[] | undefined) {
                let co: WebSocketIsomorphic.ClientOptions = {};
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
                }

                super(url, protocols, co);
                let timer: NodeJS.Timeout | undefined = undefined;
                // Parse the url for the kernel id
                const parsed = /.*\/kernels\/(.*)\/.*/.exec(url);
                if (parsed && parsed.length > 1) {
                    this.kernelId = parsed[1];
                }
                if (this.kernelId) {
                    JupyterWebSockets.set(this.kernelId, this);
                    this.on('close', () => {
                        if (timer && this.timer !== timer) {
                            clearInterval(timer as any);
                        }
                        if (JupyterWebSockets.get(this.kernelId!) === this) {
                            JupyterWebSockets.delete(this.kernelId!);
                        }
                    });
                } else {
                    traceError('KernelId not extracted from Kernel WebSocket URL');
                }

                // Ping the websocket connection every 30 seconds to make sure it stays alive
                timer = this.timer = setInterval(() => this.ping(noop), 30_000);
            }
        }
        return JupyterWebSocket as any;
    }

    public getWebsocket(id: string): IKernelSocket | undefined {
        return JupyterWebSockets.get(id);
    }

    public getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
        return nodeFetch.default as any;
    }

    public getHeadersCtor(): ClassType<Headers> {
        return nodeFetch.Headers as any;
    }

    public getRequestInit(): RequestInit {
        return { cache: 'no-store', credentials: 'same-origin' };
    }
}
