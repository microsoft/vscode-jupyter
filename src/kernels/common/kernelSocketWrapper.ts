// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from 'vscode';
import type * as WebSocketWS from 'ws';
import { ClassType } from '../../platform/ioc/types';
import { logger } from '../../platform/logging';
import { IKernelSocket } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type IWebSocketLike = {
    onopen: ((this: any, event: any) => void) | null;
    onerror: ((this: any, event: any) => void) | null;
    onclose: ((this: any, event: any) => void) | null;
    onmessage: ((this: any, event: any) => void) | null;
    emit(event: string | symbol, ...args: any[]): boolean;
    send(data: any, a2: any): void;
    close(): void;
};

/**
 * This is called a mixin class in TypeScript.
 * Allows us to have different base classes but inherit behavior (workaround for not allowing multiple inheritance).
 * Essentially it sticks a temp class in between the base class and the class you're writing.
 * Something like this:
 *
 * class Base {
 *    doStuff() {
 *
 *    }
 * }
 *
 * function Mixin = (SuperClass) {
 *   return class extends SuperClass {
 *      doExtraStuff() {
 *          super.doStuff();
 *      }
 *   }
 * }
 *
 * function SubClass extends Mixin(Base) {
 *    doBar() : {
 *        super.doExtraStuff();
 *    }
 * }
 *
 */

/**
 * A text frame reaches `handleEvent` as a Node `Buffer`: we intercept at the ws `EventEmitter`
 * layer, and `ws` converts text frames to a string only in its `addEventListener` wrapper, which
 * runs later. Receive hooks deserialize the payload, and `new DataView(buffer)` throws for a
 * `Buffer`, so hand the hooks a string for text frames.
 */
function normalizeReceivedData(args: any[]) {
    const [data, isBinary] = args;
    if (isBinary === true || typeof data === 'string' || !data || typeof data.toString !== 'function') {
        return data;
    }
    return data.toString();
}

/**
 * Adds send/receive hooks to a WebSocketLike object. These are necessary for things like IPyWidgets support.
 * @param SuperClass The class to mix into
 * @returns
 */
export function KernelSocketWrapper<T extends ClassType<IWebSocketLike>>(SuperClass: T) {
    return class BaseKernelSocket extends SuperClass implements IKernelSocket {
        private receiveHooks: ((data: WebSocketWS.Data) => Promise<void>)[];
        private sendHooks: ((data: any, cb?: (err?: Error) => void) => Promise<void>)[];
        private msgChain: Promise<any>;
        private sendChain: Promise<any>;
        private _onAnyMessage = new EventEmitter<{ msg: string; direction: 'send' }>();
        public onAnyMessage = this._onAnyMessage.event;
        constructor(...rest: any[]) {
            super(...rest);
            // Make sure the message chain is initialized
            this.msgChain = Promise.resolve();
            this.sendChain = Promise.resolve();
            this.receiveHooks = [];
            this.sendHooks = [];
        }

        protected patchSuperEmit(patch: (event: string | symbol, ...args: any[]) => boolean) {
            super.emit = patch;
        }

        public override send(data: any, a2: any): void {
            if (this.sendHooks) {
                // Stick the send hooks into the send chain. We use chain
                // to ensure that:
                // a) Hooks finish before we fire the event for real
                // b) Event fires
                // c) Next message happens after this one (so the UI can handle the message before another event goes through)
                this.sendChain = this.sendChain
                    .then(() => Promise.all(this.sendHooks.map((s) => s(data, a2))))
                    .then(() => super.send(data, a2));
            } else {
                super.send(data, a2);
            }
        }

        protected handleEvent(
            superHandler: (event: string | symbol, ...args: any[]) => boolean,
            event: string | symbol,
            ...args: any[]
        ): boolean {
            if (event === 'message' && this.receiveHooks.length) {
                // Stick the receive hooks into the message chain. We use chain
                // to ensure that:
                // a) Hooks finish before we fire the event for real
                // b) Event fires
                // c) Next message happens after this one (so this side can handle the message before another event goes through)
                this.msgChain = this.msgChain
                    .then(() => Promise.all(this.receiveHooks.map((p) => p(normalizeReceivedData(args)))))
                    // A failing hook must not swallow the message: if this `catch` sat after the
                    // `superHandler` call, a throwing hook would skip delivery entirely and the
                    // kernel would look connected while staying silent forever.
                    .catch((e) => logger.error(`Exception while handling messages: ${e}`))
                    .then(() => superHandler(event, ...args));
                // True value indicates there were handlers. We definitely have 'message' handlers.
                return true;
            } else {
                return superHandler(event, ...args);
            }
        }

        public override emit(event: string | symbol, ...args: any[]): boolean {
            if (event === 'unexpected-response' && args.length === 2) {
                const response: Record<string, any> | undefined = args[1];
                logger.error(
                    `Error in websocket: (${response?.statusCode}) ${response?.statusMessage}, ${response?.path}, Headers = ${JSON.stringify(
                        response?.headers
                    )}`
                );
            }
            if (event === 'error') {
                logger.error(`Error in websocket`, args.length ? args[0] : undefined);
            }
            return this.handleEvent((ev, ...args) => super.emit(ev, ...args), event, ...args);
        }

        public addReceiveHook(hook: (data: WebSocketWS.Data) => Promise<void>) {
            this.receiveHooks.push(hook);
        }
        public removeReceiveHook(hook: (data: WebSocketWS.Data) => Promise<void>) {
            this.receiveHooks = this.receiveHooks.filter((l) => l !== hook);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        public addSendHook(patch: (data: any, cb?: (err?: Error) => void) => Promise<void>): void {
            this.sendHooks.push(patch);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        public removeSendHook(patch: (data: any, cb?: (err?: Error) => void) => Promise<void>): void {
            this.sendHooks = this.sendHooks.filter((p) => p !== patch);
        }
    };
}
