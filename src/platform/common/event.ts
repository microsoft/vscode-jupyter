// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, CancellationToken, Disposable } from 'vscode';

export interface IWaitUntil {
    token: CancellationToken;
    waitUntil(thenable: Promise<unknown>): void;
}
export type IWaitUntilData<T> = Omit<Omit<T, 'waitUntil'>, 'token'>;

// Based on AsyncEmitter in https://github.com/microsoft/vscode/blob/88e6face01795b161523824ba075444fad55466a/src/vs/base/common/event.ts#L1303
export class AsyncEmitter<T extends IWaitUntil> {
    private _listeners: Set<(e: T) => unknown> = new Set();
    private _asyncDeliveryQueue?: Array<[(ev: T) => void, IWaitUntilData<T>]>;
    private _event: Event<T> | undefined;

    public get event(): Event<T> {
        if (!this._event) {
            this._event = (listener: (e: T) => unknown): Disposable => {
                this._listeners.add(listener);
                return {
                    dispose: () => this._listeners.delete(listener)
                };
            };
        }
        return this._event;
    }

    async fireAsync(data: IWaitUntilData<T>, token: CancellationToken): Promise<void> {
        if (!this._listeners) {
            return;
        }

        if (!this._asyncDeliveryQueue) {
            this._asyncDeliveryQueue = [];
        }

        for (const listener of this._listeners) {
            this._asyncDeliveryQueue!.push([listener, data]);
        }

        while (this._asyncDeliveryQueue.length > 0 && !token.isCancellationRequested) {
            const [listener, data] = this._asyncDeliveryQueue.shift()!;
            const thenables: Promise<unknown>[] = [];

            const event = <T>{
                ...data,
                token,
                waitUntil: (p: Promise<unknown>): void => {
                    if (Object.isFrozen(thenables)) {
                        throw new Error('waitUntil can NOT be called asynchronous');
                    }
                    thenables.push(p);
                }
            };

            try {
                listener(event);
            } catch (e) {
                console.error(e);
                continue;
            }

            // freeze thenables-collection to enforce sync-calls to
            // wait until and then wait for all thenables to resolve
            Object.freeze(thenables);

            await Promise.allSettled(thenables).then((values) => {
                for (const value of values) {
                    if (value.status === 'rejected') {
                        console.error(value.reason);
                    }
                }
            });
        }
    }

    dispose(): void {
        this._listeners.clear();
    }
}
