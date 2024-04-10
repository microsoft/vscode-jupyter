// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IDisposable } from '../types';
import { MicrotaskDelay } from './symbols';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PromiseFunction = (...any: any[]) => Promise<any>;

export async function sleep(timeout: number): Promise<number> {
    return new Promise<number>((resolve) => {
        setTimeout(() => resolve(timeout), timeout);
    });
}

export async function waitForCondition(
    condition: () => Promise<boolean>,
    timeout: number,
    interval: number
): Promise<boolean> {
    // Set a timer that will resolve with null
    return new Promise<boolean>((resolve) => {
        let finish: (result: boolean) => void;
        const timer = setTimeout(() => finish(false), timeout);
        const intervalId = setInterval(() => {
            condition()
                .then((r) => {
                    if (r) {
                        finish(true);
                    }
                })
                .catch((_e) => finish(false));
        }, interval);
        finish = (result: boolean) => {
            clearTimeout(timer);
            clearInterval(intervalId);
            resolve(result);
        };
    });
}

export function raceTimeout<T>(timeout: number, ...promises: Promise<T>[]): Promise<T | undefined>;
export function raceTimeout<T>(timeout: number, defaultValue: T, ...promises: Promise<T>[]): Promise<T>;
export function raceTimeout<T>(timeout: number, defaultValue: T, ...promises: Promise<T>[]): Promise<T> {
    const resolveValue = isPromiseLike(defaultValue) ? undefined : defaultValue;
    if (isPromiseLike(defaultValue)) {
        promises.push(defaultValue as unknown as Promise<T>);
    }

    let promiseResolve: ((value: T) => void) | undefined = undefined;

    const timer = setTimeout(() => promiseResolve?.(resolveValue as unknown as T), timeout);

    return Promise.race([
        Promise.race(promises).finally(() => clearTimeout(timer)),
        new Promise<T>((resolve) => (promiseResolve = resolve))
    ]);
}

export function raceTimeoutError<T>(timeout: number, error: Error, ...promises: Promise<T>[]): Promise<T> {
    let promiseReject: ((value: unknown) => void) | undefined = undefined;
    const timer = setTimeout(() => promiseReject?.(error), timeout);

    return Promise.race([
        Promise.race(promises).finally(() => clearTimeout(timer)),
        new Promise<T>((_, reject) => (promiseReject = reject))
    ]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPromise<T>(v: any): v is Promise<T> {
    return typeof v?.then === 'function' && typeof v?.catch === 'function';
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPromiseLike<T>(v: any): v is PromiseLike<T> {
    return typeof v?.then === 'function';
}

//======================
// Deferred

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolved: boolean;
    readonly rejected: boolean;
    readonly completed: boolean;
    readonly value?: T;
    resolve(value?: T | PromiseLike<T>): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reject(reason?: any): void;
}

class DeferredImpl<T> implements Deferred<T> {
    private _resolve!: (value: T | PromiseLike<T>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _reject!: (reason?: any) => void;
    private _resolved: boolean = false;
    private _rejected: boolean = false;
    private _promise: Promise<T>;
    private _value: T | undefined;
    public get value() {
        return this._value;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private scope: any = null) {
        // eslint-disable-next-line
        this._promise = new Promise<T>((res, rej) => {
            this._resolve = res;
            this._reject = rej;
        });
    }
    public resolve(value?: T | PromiseLike<T>) {
        this._value = value as T | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._resolve.apply(this.scope ? this.scope : this, arguments as any);
        this._resolved = true;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public reject(_reason?: any) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._reject.apply(this.scope ? this.scope : this, arguments as any);
        this._rejected = true;
    }
    get promise(): Promise<T> {
        return this._promise;
    }
    get resolved(): boolean {
        return this._resolved;
    }
    get rejected(): boolean {
        return this._rejected;
    }
    get completed(): boolean {
        return this._rejected || this._resolved;
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDeferred<T>(scope: any = null): Deferred<T> {
    return new DeferredImpl<T>(scope);
}

export function createDeferredFromPromise<T>(promise: Promise<T>): Deferred<T> {
    const deferred = createDeferred<T>();
    promise.then(deferred.resolve.bind(deferred)).catch(deferred.reject.bind(deferred));
    return deferred;
}

/**
 * Provides the ability to chain promises.
 */
export class PromiseChain {
    private currentPromise: Promise<void | undefined> = Promise.resolve(undefined);
    /**
     * Chain the provided promise after all previous promises have successfully completed.
     * If the previously chained promises have failed, then this call will fail.
     */
    public async chain<T>(promise: () => Promise<T>): Promise<T> {
        const deferred = createDeferred<T>();
        const previousPromise = this.currentPromise;
        this.currentPromise = this.currentPromise.then(async () => {
            try {
                const result = await promise();
                deferred.resolve(result);
            } catch (ex) {
                deferred.reject(ex);
                throw ex;
            }
        });
        // Wait for previous promises to complete.
        await previousPromise;
        return deferred.promise;
    }
    /**
     * Chain the provided promise after all previous promises have completed (ignoring errors in previous promises).
     */
    public chainFinally<T>(promise: () => Promise<T>): Promise<T> {
        const deferred = createDeferred<T>();
        this.currentPromise = this.currentPromise.finally(() =>
            promise()
                .then((result) => deferred.resolve(result))
                .catch((ex) => deferred.reject(ex))
        );
        return deferred.promise;
    }
}

export interface ITask<T> {
    (): T;
}

/**
 * A helper to prevent accumulation of sequential async tasks.
 *
 * Imagine a mail man with the sole task of delivering letters. As soon as
 * a letter submitted for delivery, he drives to the destination, delivers it
 * and returns to his base. Imagine that during the trip, N more letters were submitted.
 * When the mail man returns, he picks those N letters and delivers them all in a
 * single trip. Even though N+1 submissions occurred, only 2 deliveries were made.
 *
 * The throttler implements this via the queue() method, by providing it a task
 * factory. Following the example:
 *
 * 		const throttler = new Throttler();
 * 		const letters = [];
 *
 * 		function deliver() {
 * 			const lettersToDeliver = letters;
 * 			letters = [];
 * 			return makeTheTrip(lettersToDeliver);
 * 		}
 *
 * 		function onLetterReceived(l) {
 * 			letters.push(l);
 * 			throttler.queue(deliver);
 * 		}
 */
export class Throttler implements IDisposable {
    private activePromise: Promise<any> | null;
    private queuedPromise: Promise<any> | null;
    private queuedPromiseFactory: ITask<Promise<any>> | null;

    private isDisposed = false;

    constructor() {
        this.activePromise = null;
        this.queuedPromise = null;
        this.queuedPromiseFactory = null;
    }

    queue<T>(promiseFactory: ITask<Promise<T>>): Promise<T> {
        if (this.isDisposed) {
            return Promise.reject(new Error('Throttler is disposed'));
        }

        if (this.activePromise) {
            this.queuedPromiseFactory = promiseFactory;

            if (!this.queuedPromise) {
                const onComplete = () => {
                    this.queuedPromise = null;

                    if (this.isDisposed) {
                        return;
                    }

                    const result = this.queue(this.queuedPromiseFactory!);
                    this.queuedPromiseFactory = null;

                    return result;
                };

                this.queuedPromise = new Promise((resolve) => {
                    void this.activePromise!.then(onComplete, onComplete).then(resolve);
                });
            }

            return new Promise((resolve, reject) => {
                this.queuedPromise!.then(resolve, reject);
            });
        }

        this.activePromise = promiseFactory();

        return new Promise((resolve, reject) => {
            this.activePromise!.then(
                (result: T) => {
                    this.activePromise = null;
                    resolve(result);
                },
                (err: unknown) => {
                    this.activePromise = null;
                    reject(err);
                }
            );
        });
    }

    dispose(): void {
        this.isDisposed = true;
    }
}

interface IScheduledLater extends IDisposable {
    isTriggered(): boolean;
}

const timeoutDeferred = (timeout: number, fn: () => void): IScheduledLater => {
    let scheduled = true;
    const handle = setTimeout(() => {
        scheduled = false;
        fn();
    }, timeout);
    return {
        isTriggered: () => scheduled,
        dispose: () => {
            clearTimeout(handle);
            scheduled = false;
        }
    };
};

const microtaskDeferred = (fn: () => void): IScheduledLater => {
    let scheduled = true;
    queueMicrotask(() => {
        if (scheduled) {
            scheduled = false;
            fn();
        }
    });

    return {
        isTriggered: () => scheduled,
        dispose: () => {
            scheduled = false;
        }
    };
};

/**
 * A helper to delay (debounce) execution of a task that is being requested often.
 *
 * Following the throttler, now imagine the mail man wants to optimize the number of
 * trips proactively. The trip itself can be long, so he decides not to make the trip
 * as soon as a letter is submitted. Instead he waits a while, in case more
 * letters are submitted. After said waiting period, if no letters were submitted, he
 * decides to make the trip. Imagine that N more letters were submitted after the first
 * one, all within a short period of time between each other. Even though N+1
 * submissions occurred, only 1 delivery was made.
 *
 * The delayer offers this behavior via the trigger() method, into which both the task
 * to be executed and the waiting period (delay) must be passed in as arguments. Following
 * the example:
 *
 * 		const delayer = new Delayer(WAITING_PERIOD);
 * 		const letters = [];
 *
 * 		function letterReceived(l) {
 * 			letters.push(l);
 * 			delayer.trigger(() => { return makeTheTrip(); });
 * 		}
 */
export class Delayer<T> implements IDisposable {
    private deferred: IScheduledLater | null;
    private completionPromise: Promise<any> | null;
    private doResolve: ((value?: any | Promise<any>) => void) | null;
    private doReject: ((err: any) => void) | null;
    private task: ITask<T | Promise<T>> | null;

    constructor(public defaultDelay: number | typeof MicrotaskDelay) {
        this.deferred = null;
        this.completionPromise = null;
        this.doResolve = null;
        this.doReject = null;
        this.task = null;
    }

    trigger(task: ITask<T | Promise<T>>, delay = this.defaultDelay): Promise<T> {
        this.task = task;
        this.cancelTimeout();

        if (!this.completionPromise) {
            this.completionPromise = new Promise((resolve, reject) => {
                this.doResolve = resolve;
                this.doReject = reject;
            }).then(() => {
                this.completionPromise = null;
                this.doResolve = null;
                if (this.task) {
                    const task = this.task;
                    this.task = null;
                    return task();
                }
                return undefined;
            });
        }

        const fn = () => {
            this.deferred = null;
            this.doResolve?.(null);
        };

        this.deferred = delay === MicrotaskDelay ? microtaskDeferred(fn) : timeoutDeferred(delay, fn);

        return this.completionPromise;
    }

    isTriggered(): boolean {
        return !!this.deferred?.isTriggered();
    }

    cancel(): void {
        this.cancelTimeout();

        if (this.completionPromise) {
            this.doReject?.(new Error('Canceled'));
            this.completionPromise = null;
        }
    }

    private cancelTimeout(): void {
        this.deferred?.dispose();
        this.deferred = null;
    }

    dispose(): void {
        this.cancel();
    }
}

/**
 * A helper to delay execution of a task that is being requested often, while
 * preventing accumulation of consecutive executions, while the task runs.
 *
 * The mail man is clever and waits for a certain amount of time, before going
 * out to deliver letters. While the mail man is going out, more letters arrive
 * and can only be delivered once he is back. Once he is back the mail man will
 * do one more trip to deliver the letters that have accumulated while he was out.
 */
export class ThrottledDelayer<T> {
    private delayer: Delayer<Promise<T>>;
    private throttler: Throttler;

    constructor(defaultDelay: number) {
        this.delayer = new Delayer(defaultDelay);
        this.throttler = new Throttler();
    }

    trigger(promiseFactory: ITask<Promise<T>>, delay?: number): Promise<T> {
        return this.delayer.trigger(() => this.throttler.queue(promiseFactory), delay) as unknown as Promise<T>;
    }

    isTriggered(): boolean {
        return this.delayer.isTriggered();
    }

    cancel(): void {
        this.delayer.cancel();
    }

    dispose(): void {
        this.delayer.dispose();
        this.throttler.dispose();
    }
}
