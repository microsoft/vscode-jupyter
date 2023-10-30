// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from 'vscode';
import * as WebSocketWS from 'ws';
import { ClassType } from '../../platform/ioc/types';
import { traceError } from '../../platform/logging';
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
 * Adds send/recieve hooks to a WebSocketLike object. These are necessary for things like IPyWidgets support.
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
                    .then(() => Promise.all(this.receiveHooks.map((p) => p(args[0]))))
                    .then(() => superHandler(event, ...args))
                    .catch((e) => traceError(`Exception while handling messages: ${e}`));
                // True value indicates there were handlers. We definitely have 'message' handlers.
                return true;
            } else {
                return superHandler(event, ...args);
            }
        }

        public override emit(event: string | symbol, ...args: any[]): boolean {
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
