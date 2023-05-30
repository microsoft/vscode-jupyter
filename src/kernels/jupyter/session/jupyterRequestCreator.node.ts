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
    public getRequestCtor(_allowUnauthorized?: boolean, getAuthHeader?: () => Record<string, string>) {
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

        return (
            getAuthHeader && Object.keys(getAuthHeader() || {}).length ? AuthorizingRequest : nodeFetch.Request
        ) as any;
    }

    public getWebsocketCtor(
        allowUnauthorized?: boolean,
        getAuthHeaders?: () => Record<string, string>,
        getWebSocketProtocols?: () => string | string[] | undefined
    ): typeof WebSocket {
        const generateOptions = (): WebSocketIsomorphic.ClientOptions => {
            const clientOptions: WebSocketIsomorphic.ClientOptions = {};

            if (allowUnauthorized) {
                clientOptions.rejectUnauthorized = false;
            }

            // Auth headers have to be refetched every time we create a connection. They may have expired
            // since the last connection.
            if (getAuthHeaders) {
                clientOptions.headers = getAuthHeaders();
            }
            return clientOptions;
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
