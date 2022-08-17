// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import WebSocketIsomorphic from 'isomorphic-ws';
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
    public getRequestCtor(cookieString?: string, allowUnauthorized?: boolean, getAuthHeaders?: () => any) {
        class AuthorizingRequest extends Request {
            constructor(input: RequestInfo, init?: RequestInit) {
                super(input, init);

                // Add all of the authorization parts onto the headers.
                const origHeaders = this.headers;

                if (getAuthHeaders) {
                    const authorizationHeader = getAuthHeaders();
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

                // Append the other settings we might need too
                if (allowUnauthorized) {
                    // rejectUnauthorized not allowed in web so we can't do anything here.
                }

                if (cookieString) {
                    this.headers.append('Cookie', cookieString);
                }
            }
        }

        return AuthorizingRequest;
    }

    public getWebsocketCtor(_cookieString?: string, _allowUnauthorized?: boolean, _getAuthHeaders?: () => any) {
        class JupyterWebSocket extends KernelSocketWrapper(WebSocketIsomorphic) {
            private kernelId: string | undefined;
            private timer: NodeJS.Timeout | number = 0;
            private boundOpenHandler = this.openHandler.bind(this);

            constructor(url: string, protocols?: string | string[] | undefined) {
                super(url, protocols);
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

                // TODO: Implement ping. Well actually see if ping is necessary
                // Ping the websocket connection every 30 seconds to make sure it stays alive
                //timer = this.timer = setInterval(() => this.ping(), 30_000);

                // On open, replace the onmessage handler with our own.
                this.addEventListener('open', this.boundOpenHandler);
            }

            private openHandler() {
                // Node version uses emit override to handle messages before they go to jupyter (and pause messages)
                // We need a workaround. There is no 'emit' on websockets for the web so we have to create one.
                const originalMessageHandler = this.onmessage;

                // We do this by replacing the set onmessage (set by jupyterlabs) with our
                // own version
                this.onmessage = (ev) => {
                    this.handleEvent(
                        (ev, ...args) => {
                            const event: WebSocketIsomorphic.MessageEvent = {
                                data: args[0],
                                type: ev.toString(),
                                target: this
                            };
                            originalMessageHandler(event);
                            return true;
                        },
                        'message',
                        ev.data
                    );
                };

                this.removeEventListener('open', this.boundOpenHandler);
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
