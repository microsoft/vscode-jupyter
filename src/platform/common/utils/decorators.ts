// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, , no-invalid-this */

import { isTestExecution } from '../constants';
import { createDeferred, Deferred } from './async';
import { DataWithExpiry, getCacheKeyFromFunctionArgs, getGlobalCacheStore } from './cacheUtils';
import { noop, TraceInfo, tracing } from './misc';
import { traceError, traceVerbose } from '../../logging';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const _debounce = require('lodash/debounce') as typeof import('lodash/debounce');

type VoidFunction = () => any;
type AsyncVoidFunction = () => Promise<any>;

/**
 * Combine multiple sequential calls to the decorated function into one.
 * @export
 * @param {number} [wait] Wait time (milliseconds).
 * @returns void
 *
 * The point is to ensure that successive calls to the function result
 * only in a single actual call.  Following the most recent call to
 * the debounced function, debouncing resets after the "wait" interval
 * has elapsed.
 */
export function debounceSync(wait?: number) {
    if (isTestExecution()) {
        // If running tests, lets debounce until the next cycle in the event loop.
        // Same as `setTimeout(()=> {}, 0);` with a value of `0`.
        wait = undefined;
    }
    return makeDebounceDecorator(wait);
}

/**
 * Combine multiple sequential calls to the decorated async function into one.
 * @export
 * @param {number} [wait] Wait time (milliseconds).
 * @returns void
 *
 * The point is to ensure that successive calls to the function result
 * only in a single actual call.  Following the most recent call to
 * the debounced function, debouncing resets after the "wait" interval
 * has elapsed.
 */
export function debounceAsync(wait?: number) {
    if (isTestExecution()) {
        // If running tests, lets debounce until the next cycle in the event loop.
        // Same as `setTimeout(()=> {}, 0);` with a value of `0`.
        wait = undefined;
    }
    return makeDebounceAsyncDecorator(wait);
}

export function makeDebounceDecorator(wait?: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any,
    return function (_target: any, _propertyName: string, descriptor: TypedPropertyDescriptor<VoidFunction>) {
        // We could also make use of _debounce() options.  For instance,
        // the following causes the original method to be called
        // immediately:
        //
        //   {leading: true, trailing: false}
        //
        // The default is:
        //
        //   {leading: false, trailing: true}
        //
        // See https://lodash.com/docs/#debounce.
        const options = {};
        const originalMethod = descriptor.value!;
        const debounced = _debounce(
            function (this: any) {
                return originalMethod.apply(this, arguments as any);
            },
            wait,
            options
        );
        (descriptor as any).value = debounced;
    };
}

export function makeDebounceAsyncDecorator(wait?: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any,
    return function (_target: any, _propertyName: string, descriptor: TypedPropertyDescriptor<AsyncVoidFunction>) {
        type StateInformation = {
            started: boolean;
            deferred: Deferred<any> | undefined;
            timer: NodeJS.Timer | number | undefined;
        };
        const originalMethod = descriptor.value!;
        const state: StateInformation = { started: false, deferred: undefined, timer: undefined };

        // Lets defer execution using a setTimeout for the given time.
        (descriptor as any).value = function (this: any) {
            const existingDeferred: Deferred<any> | undefined = state.deferred;
            if (existingDeferred && state.started) {
                return existingDeferred.promise;
            }

            // Clear previous timer.
            const existingDeferredCompleted = existingDeferred && existingDeferred.completed;
            const deferred = (state.deferred =
                !existingDeferred || existingDeferredCompleted ? createDeferred<any>() : existingDeferred);
            deferred.promise.catch(noop);
            if (state.timer) {
                clearTimeout(state.timer as any);
            }

            state.timer = setTimeout(async () => {
                state.started = true;
                originalMethod
                    .apply(this)
                    .then((r) => {
                        state.started = false;
                        deferred.resolve(r);
                    })
                    .catch((ex) => {
                        state.started = false;
                        deferred.reject(ex);
                    });
            }, wait || 0);
            return deferred.promise;
        };
    };
}

type PromiseFunctionWithAnyArgs = (...any: any) => Promise<any>;
const cacheStoreForMethods = getGlobalCacheStore();
export function cache(expiryDurationMs: number) {
    return function (
        target: Object,
        propertyName: string,
        descriptor: TypedPropertyDescriptor<PromiseFunctionWithAnyArgs>
    ) {
        const originalMethod = descriptor.value!;
        const className = 'constructor' in target && target.constructor.name ? target.constructor.name : '';
        const keyPrefix = `Cache_Method_Output_${className}.${propertyName}`;
        descriptor.value = async function (...args: any) {
            if (isTestExecution()) {
                return originalMethod.apply(this, args) as Promise<any>;
            }
            const key = getCacheKeyFromFunctionArgs(keyPrefix, args);
            const cachedItem = cacheStoreForMethods.get(key);
            if (cachedItem && !cachedItem.expired) {
                traceVerbose(`Cached data exists ${key}`);
                return Promise.resolve(cachedItem.data);
            }
            const promise = originalMethod.apply(this, args) as Promise<any>;
            promise
                .then((result) => cacheStoreForMethods.set(key, new DataWithExpiry(expiryDurationMs, result)))
                .catch(noop);
            return promise;
        };
    };
}

/**
 * Swallows exceptions thrown by a function. Function must return either a void or a promise that resolves to a void.
 * When exceptions (including in promises) are caught, this will return `undefined` to calling code.
 * @export
 * @param {string} [scopeName] Scope for the error message to be logged along with the error.
 * @returns void
 */
export function swallowExceptions(scopeName?: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any,
    return function (_target: any, propertyName: string, descriptor: TypedPropertyDescriptor<any>) {
        const originalMethod = descriptor.value!;
        const errorMessage = `Jupyter Extension (Error in ${scopeName || propertyName}, method:${propertyName}):`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any,
        descriptor.value = function (...args: any[]) {
            try {
                // eslint-disable-next-line no-invalid-this, @typescript-eslint/no-use-before-define,
                const result = originalMethod.apply(this, args);

                // If method being wrapped returns a promise then wait and swallow errors.
                if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
                    return (result as Promise<void>).catch((error) => {
                        if (isTestExecution()) {
                            return;
                        }
                        traceError(errorMessage, error);
                    });
                }
            } catch (error) {
                if (isTestExecution()) {
                    return;
                }
                traceError(errorMessage, error);
            }
        };
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PromiseFunction = (...any: any[]) => Promise<any>;

// Information about a function/method call.
export type CallInfo = {
    kind: string; // "Class", etc.
    name: string;
    methodName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any[];
    target: Object;
};

// Return a decorator that traces the decorated function.
export function trace(log: (c: CallInfo, t: TraceInfo) => void, logBeforeCall?: boolean) {
    // eslint-disable-next-line , @typescript-eslint/no-explicit-any
    return function (target: Object, methodName: string, descriptor: TypedPropertyDescriptor<any>) {
        const originalMethod = descriptor.value;
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        descriptor.value = function (...args: any[]) {
            const call = {
                kind: 'Class',
                name: target && target.constructor ? target.constructor.name : '',
                args,
                methodName,
                target
            };
            // eslint-disable-next-line @typescript-eslint/no-this-alias, no-invalid-this
            const scope = this;
            return tracing(
                // "log()"
                (t) => log(call, t),
                // "run()"
                () => originalMethod.apply(scope, args),
                logBeforeCall
            );
        };

        return descriptor;
    };
}

// Mark a method to be used only in tests
export function testOnlyMethod() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function (_target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) {
        const originalMethod = descriptor.value;
        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        descriptor.value = function (...args: any[]) {
            if (!isTestExecution()) {
                throw new Error(`Function: ${propertyKey} can only be called from test code`);
            }
            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}

// Mark a method that returns a promise to chain it
export function chainable() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function (_target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<PromiseFunction>) {
        const originalMethod = descriptor.value!;
        const chainedKey = `chainedPromiseFor_${propertyKey}`;

        // eslint-disable-next-line , @typescript-eslint/no-explicit-any
        descriptor.value = async function (...args: any[]) {
            // Check for promise in the object.
            let currentValue = (this as any)[chainedKey] as Promise<any>;
            if (currentValue) {
                currentValue = currentValue.then(() => originalMethod.apply(this, args));
            } else {
                currentValue = originalMethod.apply(this, args);
            }

            // Save promise in object
            (this as any)[chainedKey] = currentValue;

            // If promise fails, clear it.
            const promise = currentValue
                .then((r) => r)
                .catch((e) => {
                    (this as any)[chainedKey] = undefined;
                    throw e;
                });
            // Handle the exception to prevent node from warning about unhandled exceptions.
            promise.catch(noop);
            return promise;
        };

        return descriptor;
    };
}
