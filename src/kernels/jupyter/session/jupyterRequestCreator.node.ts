// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IJupyterRequestCreator } from '../types';
import type * as nodeFetch from 'node-fetch';
import { ClassType } from '../../../platform/ioc/types';
import WebSocketIsomorphic from 'isomorphic-ws';
import { traceError } from '../../../platform/logging';
import { noop } from '../../../platform/common/utils/misc';
import { KernelSocketWrapper } from '../../common/kernelSocketWrapper';
import { injectable } from 'inversify';
import { KernelSocketMap } from '../../kernelSocket';

// Function for creating node Request object that prevents jupyterlab services from writing its own
// authorization header.
/* eslint-disable @typescript-eslint/no-explicit-any */
@injectable()
export class JupyterRequestCreator implements IJupyterRequestCreator {
    public getRequestCtor(_cookieString?: string, _allowUnauthorized?: boolean, getAuthHeader?: () => any) {
        const nodeFetch = require('node-fetch');
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
                origHeaders.append = (k: any, v: any) => {
                    if (k.toLowerCase() !== 'authorization') {
                        origAppend(k, v);
                    }
                };
            }
        }

        return (
            getAuthHeader && Object.keys(getAuthHeader() || {}).length ? AuthorizingRequest : nodeFetch.Request
        ) as any;
    }

    public getWebsocketCtor(
        cookieString?: string,
        allowUnauthorized?: boolean,
        getAuthHeaders?: () => Record<string, string>,
        getWebSocketProtocols?: () => string | string[] | undefined
    ): ClassType<WebSocket> {
        const generateOptions = (): WebSocketIsomorphic.ClientOptions => {
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
            return co;
        };
        const getProtocols = (protocols?: string | string[]): string | string[] | undefined => {
            const authProtocols = getWebSocketProtocols ? getWebSocketProtocols() : undefined;
            if (!authProtocols && !protocols) {
                return;
            }
            if (!protocols && authProtocols) {
                return authProtocols;
            }
            if (protocols && !authProtocols) {
                return protocols;
            }
            protocols = !protocols ? [] : typeof protocols === 'string' ? [protocols] : protocols;
            if (Array.isArray(authProtocols)) {
                protocols.push(...authProtocols);
            } else if (typeof authProtocols === 'string') {
                protocols.push(authProtocols);
            }
            return protocols;
        };
        class JupyterWebSocket extends KernelSocketWrapper(WebSocketIsomorphic) {
            private kernelId: string | undefined;
            private timer: NodeJS.Timeout | number;

            constructor(url: string, protocols?: string | string[] | undefined) {
                super(url, getProtocols(protocols), generateOptions());
                let timer: NodeJS.Timeout | undefined = undefined;
                // Parse the url for the kernel id
                const parsed = /.*\/kernels\/(.*)\/.*/.exec(url);
                if (parsed && parsed.length > 1) {
                    this.kernelId = parsed[1];
                }
                if (this.kernelId) {
                    KernelSocketMap.set(this.kernelId, this);
                    this.on('close', () => {
                        if (timer && this.timer !== timer) {
                            clearInterval(timer as any);
                        }
                        if (KernelSocketMap.get(this.kernelId!) === this) {
                            KernelSocketMap.delete(this.kernelId!);
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
    public wrapWebSocketCtor(websocketCtor: ClassType<WebSocketIsomorphic>): ClassType<WebSocketIsomorphic> {
        class JupyterWebSocket extends KernelSocketWrapper(websocketCtor) {
            private kernelId: string | undefined;
            private timer: NodeJS.Timeout | number;

            constructor(url: string, protocols?: string | string[] | undefined, options?: unknown) {
                super(url, protocols, options);
                let timer: NodeJS.Timeout | undefined = undefined;
                // Parse the url for the kernel id
                const parsed = /.*\/kernels\/(.*)\/.*/.exec(url);
                if (parsed && parsed.length > 1) {
                    this.kernelId = parsed[1];
                }
                if (this.kernelId) {
                    KernelSocketMap.set(this.kernelId, this);
                    this.on('close', () => {
                        if (timer && this.timer !== timer) {
                            clearInterval(timer as any);
                        }
                        if (KernelSocketMap.get(this.kernelId!) === this) {
                            KernelSocketMap.delete(this.kernelId!);
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

    public getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
        return require('node-fetch');
    }

    public getHeadersCtor(): ClassType<Headers> {
        return require('node-fetch').Headers as any;
    }

    public getRequestInit(): RequestInit {
        return { cache: 'no-store', credentials: 'same-origin' };
    }
}
