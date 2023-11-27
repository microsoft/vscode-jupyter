// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { VSCodeEvent } from 'vscode-notebook-renderer/events';
import { WebviewMessage } from '../../../platform/common/application/types';
import { IDisposable } from '../../../platform/common/types';
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

interface IMessageApi {
    register(msgCallback: (msg: WebviewMessage) => Promise<void>): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendMessage(type: string, payload?: any): void;
    dispose(): void;
}

declare var onDidReceiveKernelMessage: KernelMessagingApi['onDidReceiveKernelMessage'];
declare var postKernelMessage: KernelMessagingApi['postKernelMessage'];

// This special function talks to vscode from a web panel
export declare function acquireVsCodeApi(): IVsCodeApi;
// Provides support for messaging when using the vscode webview messaging api
class VsCodeMessageApi implements IMessageApi {
    private messageCallback: ((msg: WebviewMessage) => Promise<void>) | undefined;
    private vscodeApi: IVsCodeApi | undefined;
    private registered: boolean = false;
    private baseHandler = this.handleVSCodeApiMessages.bind(this);

    public register(msgCallback: (msg: WebviewMessage) => Promise<void>) {
        this.messageCallback = msgCallback;

        // Only do this once as it crashes if we ask more than once
        // eslint-disable-next-line
        if (!this.vscodeApi && typeof acquireVsCodeApi !== 'undefined') {
            this.vscodeApi = acquireVsCodeApi(); // NOSONAR
            // eslint-disable-next-line @typescript-eslint/no-explicit-any,
        } else if (!this.vscodeApi && typeof (window as any).acquireVsCodeApi !== 'undefined') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.vscodeApi = (window as any).acquireVsCodeApi();
        }
        if (!this.vscodeApi) {
            console.error('The vscode api is not set');
        }
        if (!this.registered) {
            this.registered = true;
            window.addEventListener('message', this.baseHandler);

            try {
                // For testing, we might use a  browser to load  the stuff.
                // In such instances the `acquireVSCodeApi` will return the event handler to get messages from extension.
                // See ./src/webviews/webview-side/native-editor/index.html
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const api = this.vscodeApi as any as undefined | { handleMessage?: Function };
                if (api && api.handleMessage) {
                    api.handleMessage(this.handleVSCodeApiMessages.bind(this));
                }
            } catch {
                // Ignore.
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public sendMessage(type: string, payload?: any) {
        if (this.vscodeApi) {
            this.vscodeApi.postMessage({ type: type, payload });
        } else if (type === 'IPyWidgets_logMessage') {
            logMessage(`Logging message ${type}, ${payload}`);
        } else {
            logMessage(`No vscode API to post message ${type}`);
        }
    }

    public dispose() {
        if (this.registered) {
            this.registered = false;
            window.removeEventListener('message', this.baseHandler);
        }
    }

    private async handleVSCodeApiMessages(ev: MessageEvent) {
        const msg = ev.data as WebviewMessage;
        if (msg && this.messageCallback) {
            await this.messageCallback(msg);
        }
    }
}

// Provides support for messaging when hosted via a native notebook preload
class KernelMessageApi implements IMessageApi {
    private messageCallback: ((msg: WebviewMessage) => Promise<void>) | undefined;
    private kernelHandler: IDisposable | undefined;
    private readonly kernelMessagingApi: KernelMessagingApi;
    constructor(kernelMessagingApi?: KernelMessagingApi) {
        this.kernelMessagingApi = kernelMessagingApi
            ? kernelMessagingApi
            : {
                  onDidReceiveKernelMessage,
                  postKernelMessage
              };
    }

    public register(msgCallback: (msg: WebviewMessage) => Promise<void>) {
        this.messageCallback = msgCallback;
        if (!this.kernelHandler) {
            this.kernelHandler = this.kernelMessagingApi.onDidReceiveKernelMessage(this.handleKernelMessage.bind(this));
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public sendMessage(type: string, payload?: any) {
        this.kernelMessagingApi.postKernelMessage({ type: type, payload });
    }

    public dispose() {
        if (this.kernelHandler) {
            this.kernelHandler.dispose();
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async handleKernelMessage(ev: unknown) {
        const msg = ev as unknown as WebviewMessage;
        if (msg && this.messageCallback) {
            await this.messageCallback(msg);
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PostOfficeMessage = { type: string; payload?: any };
export type KernelMessagingApi = {
    onDidReceiveKernelMessage: VSCodeEvent<unknown>;
    postKernelMessage: (data: unknown) => void;
};

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PostOffice implements IDisposable {
    private messageApi: IMessageApi | undefined;
    private handlers: IMessageHandler[] = [];
    constructor(private readonly kernelMessagingApi?: KernelMessagingApi) {}
    public dispose() {
        if (this.messageApi) {
            this.messageApi.dispose();
        }
    }

    public sendMessage<M, T extends keyof M = keyof M>(type: T, payload?: M[T]) {
        return this.sendUnsafeMessage(type.toString(), payload);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public sendUnsafeMessage(type: string, payload?: any) {
        if (this.messageApi) {
            this.messageApi.sendMessage(type, payload);
        } else if (type === 'IPyWidgets_logMessage') {
            console.log('Message not sent', type, payload);
        } else {
            logMessage(`No message API to post message ${type}`);
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

    // Hook up to our messaging API
    public acquireApi() {
        if (this.messageApi) {
            return;
        }

        // If the kernel message API is available use that if not use the VS Code webview messaging API
        if (this.useKernelMessageApi()) {
            this.messageApi = new KernelMessageApi(this.kernelMessagingApi);
        } else {
            this.messageApi = new VsCodeMessageApi();
        }

        this.messageApi.register(this.handleMessage.bind(this));
    }

    // Check to see if global kernel message API is supported, if so use that
    // instead of the VSCodeAPI which is not available in NativeNotebooks
    private useKernelMessageApi(): boolean {
        if (
            (this.kernelMessagingApi && typeof this.kernelMessagingApi.postKernelMessage !== 'undefined') ||
            typeof postKernelMessage !== 'undefined'
        ) {
            return true;
        }

        return false;
    }

    private async handleMessage(msg: WebviewMessage) {
        if (this.handlers) {
            if (msg) {
                this.handlers.forEach((h: IMessageHandler | null) => {
                    if (h) {
                        h.handleMessage(msg.type, msg.payload);
                    }
                });
            }
        }
    }
}
