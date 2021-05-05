// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { VSCodeEvent } from 'vscode-notebook-renderer';
import { WebviewMessage } from '../../client/common/application/types';
import { IDisposable } from '../../client/common/types';
import { logMessage } from './logger';

export interface IVsCodeApi {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    postMessage(msg: any): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setState(state: any): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getState(): any;
}

export interface IMessageHandler {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(type: string, payload?: any): boolean;
    dispose?(): void;
}

// This special function talks to vscode from a web panel
export declare function acquireVsCodeApi(): IVsCodeApi;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PostOfficeMessage = { type: string; payload?: any };
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PostOffice implements IDisposable {
    private registered: boolean = false;
    private vscodeApi: IVsCodeApi | undefined;
    private handlers: IMessageHandler[] = [];
    private baseHandler = this.handleVSCodeApiMessages.bind(this);
    private readonly subject = new Subject<PostOfficeMessage>();
    private readonly observable: Observable<PostOfficeMessage>;
    constructor() {
        this.observable = this.subject.asObservable();
    }
    public asObservable(): Observable<PostOfficeMessage> {
        return this.observable;
    }
    public dispose() {
        if (this.registered) {
            this.registered = false;
            window.removeEventListener('message', this.baseHandler);
        }
    }

    public sendMessage<M, T extends keyof M = keyof M>(type: T, payload?: M[T]) {
        return this.sendUnsafeMessage(type.toString(), payload);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public sendUnsafeMessage(type: string, payload?: any) {
        if (this.useKernelMessageApi()) {
            postKernelMessage({ type: type, payload });
        } else {
            const api = this.acquireApi();
            if (api) {
                logMessage(`UI PostOffice Sent ${type}`);
                api.postMessage({ type: type, payload });
            } else {
                logMessage(`No vscode API to post message ${type}`);
            }
        }
    }

    public addHandler(handler: IMessageHandler) {
        // Acquire here too so that the message handlers are setup during tests.
        this.acquireApi();
        this.handlers.push(handler);
    }

    public removeHandler(handler: IMessageHandler) {
        this.handlers = this.handlers.filter((f) => f !== handler);
    }

    public acquireApi(): IVsCodeApi | undefined {
        console.log('IANHU acquire vscode API');

        if (!this.useKernelMessageApi()) {
            // Only do this once as it crashes if we ask more than once
            // eslint-disable-next-line
            if (!this.vscodeApi && typeof acquireVsCodeApi !== 'undefined') {
                console.log('IANHU found typeof acquireVsCodeApi');
                this.vscodeApi = acquireVsCodeApi(); // NOSONAR
                // eslint-disable-next-line @typescript-eslint/no-explicit-any,
            } else if (!this.vscodeApi && typeof (window as any).acquireVsCodeApi !== 'undefined') {
                console.log('IANHU found acquireVsCodeApi on window');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.vscodeApi = (window as any).acquireVsCodeApi();
            }
            if (!this.registered) {
                this.registered = true;
                window.addEventListener('message', this.baseHandler);

                try {
                    // For testing, we might use a  browser to load  the stuff.
                    // In such instances the `acquireVSCodeApi` will return the event handler to get messages from extension.
                    // See ./src/datascience-ui/native-editor/index.html
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const api = (this.vscodeApi as any) as undefined | { handleMessage?: Function };
                    if (api && api.handleMessage) {
                        api.handleMessage(this.handleVSCodeApiMessages.bind(this));
                    }
                } catch {
                    // Ignore.
                }
            }
        } else {
            // Hook up to incoming kernel messages
            if (!this.registered) {
                console.log('IANHU register kernel message handler');
                this.registered = true;
                onDidReceiveKernelMessage(this.handleKernelMessage.bind(this));
            }
        }

        return this.vscodeApi;
    }
    private useKernelMessageApi(): boolean {
        console.log('IANHU checking kernel message api');
        // Check to see if global postKernelMessage api is there
        if (typeof postKernelMessage !== 'undefined') {
            console.log('IANHU global postKernelMessage found');
            return true;
        }

        return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleKernelMessage(ev: VSCodeEvent<any>) {
        const msg = (ev as unknown) as WebviewMessage;
        if (msg) {
            await this.handleMessage(msg);
        }
    }

    private async handleVSCodeApiMessages(ev: MessageEvent) {
        const msg = ev.data as WebviewMessage;
        if (msg) {
            await this.handleMessage(msg);
        }
    }

    private async handleMessage(msg: WebviewMessage) {
        if (this.handlers) {
            if (msg) {
                if ('type' in msg && typeof msg.type === 'string') {
                    logMessage(`UI PostOffice Received ${msg.type}`);
                }
                this.subject.next({ type: msg.type, payload: msg.payload });
                this.handlers.forEach((h: IMessageHandler | null) => {
                    if (h) {
                        h.handleMessage(msg.type, msg.payload);
                    }
                });
            }
        }
    }
}
