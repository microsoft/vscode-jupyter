// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, Disposable, Event } from 'vscode';
import { IDisposable } from '../types';
import { EmptyDisposable } from './lifecycle';

/**
 * Given an event, returns another event which only fires once.
 */
export function once<T>(event: Event<T>): Event<T> {
    return (listener, thisArgs = null, disposables?) => {
        // we need this, in case the event fires during the listener call
        let didFire = false;
        let result: IDisposable | undefined = undefined;
        result = event(
            (e) => {
                if (didFire) {
                    return;
                } else if (result) {
                    result.dispose();
                } else {
                    didFire = true;
                }

                return listener.call(thisArgs, e);
            },
            null,
            disposables
        );

        if (didFire) {
            result.dispose();
        }

        return result;
    };
}

/**
 * Creates a promise out of an event, using the once helper.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toPromise<T>(event: Event<T>, thisArgs: any = null, disposables?: IDisposable[]): Promise<T> {
    return new Promise((resolve) => once(event)(resolve, thisArgs, disposables));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EmptyEvent: Event<any> = () => EmptyDisposable;

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
            this._event = (listener: (e: T) => unknown, thisArg?: unknown, disposables?: Disposable[]): Disposable => {
                this._listeners.add(thisArg ? listener.bind(thisArg) : listener);
                const disposable = new Disposable(() => this._listeners.delete(listener));
                disposables?.push(disposable);
                return disposable;
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
