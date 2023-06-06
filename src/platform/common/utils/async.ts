// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

//================================
// iterators

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
