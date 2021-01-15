// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { TextDocument, Uri } from 'vscode';
import { NotebookCellScheme } from '../constants';
import { InterpreterUri } from '../installer/types';
import { IAsyncDisposable, IDisposable, Resource } from '../types';
import { isPromise } from './async';
import { StopWatch } from './stopWatch';

// eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
export function noop() {}

/**
 * Execute a block of code ignoring any exceptions.
 */
export function swallowExceptions(cb: Function) {
    try {
        cb();
    } catch {
        // Ignore errors.
    }
}

export function using<T extends IDisposable>(disposable: T, func: (obj: T) => void) {
    try {
        func(disposable);
    } finally {
        disposable.dispose();
    }
}

export async function usingAsync<T extends IAsyncDisposable, R>(
    disposable: T,
    func: (obj: T) => Promise<R>
): Promise<R> {
    try {
        return await func(disposable);
    } finally {
        await disposable.dispose();
    }
}

/**
 * Like `Readonly<>`, but recursive.
 *
 * See https://github.com/Microsoft/TypeScript/pull/21316.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeepReadonly<T> = T extends any[] ? IDeepReadonlyArray<T[number]> : DeepReadonlyNonArray<T>;
type DeepReadonlyNonArray<T> = T extends object ? DeepReadonlyObject<T> : T;
interface IDeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> {}
type DeepReadonlyObject<T> = {
    readonly [P in NonFunctionPropertyNames<T>]: DeepReadonly<T[P]>;
};
type NonFunctionPropertyNames<T> = { [K in keyof T]: T[K] extends Function ? never : K }[keyof T];

// Information about a traced function/method call.
export type TraceInfo = {
    elapsed: number; // milliseconds
    // Either returnValue or err will be set.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    returnValue?: any;
    err?: Error;
};

// Call run(), call log() with the trace info, and return the result.
export function tracing<T>(log: (t: TraceInfo) => void, run: () => T): T {
    const timer = new StopWatch();
    try {
        // eslint-disable-next-line no-invalid-this, @typescript-eslint/no-use-before-define,
        const result = run();

        // If method being wrapped returns a promise then wait for it.
        if (isPromise(result)) {
            // eslint-disable-next-line
            (result as Promise<void>)
                .then((data) => {
                    log({ elapsed: timer.elapsedTime, returnValue: data });
                    return data;
                })
                .catch((ex) => {
                    log({ elapsed: timer.elapsedTime, err: ex });
                    // eslint-disable-next-line
                    // TODO(GH-11645) Re-throw the error like we do
                    // in the non-Promise case.
                });
        } else {
            log({ elapsed: timer.elapsedTime, returnValue: result });
        }
        return result;
    } catch (ex) {
        log({ elapsed: timer.elapsedTime, err: ex });
        throw ex;
    }
}

/**
 * Checking whether something is a Resource (Uri/undefined).
 * Using `instanceof Uri` doesn't always work as the object is not an instance of Uri (at least not in tests).
 * That's why VSC too has a helper method `URI.isUri` (though not public).
 *
 * @export
 * @param {InterpreterUri} [resource]
 * @returns {resource is Resource}
 */
export function isResource(resource?: InterpreterUri): resource is Resource {
    if (!resource) {
        return true;
    }
    const uri = resource as Uri;
    return typeof uri.path === 'string' && typeof uri.scheme === 'string';
}

/**
 * Checking whether something is a Uri.
 * Using `instanceof Uri` doesn't always work as the object is not an instance of Uri (at least not in tests).
 * That's why VSC too has a helper method `URI.isUri` (though not public).
 *
 * @export
 * @param {InterpreterUri} [resource]
 * @returns {resource is Uri}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isUri(resource?: Uri | any): resource is Uri {
    if (!resource) {
        return false;
    }
    const uri = resource as Uri;
    return typeof uri.path === 'string' && typeof uri.scheme === 'string';
}

export function isNotebookCell(documentOrUri: TextDocument | Uri): boolean {
    const uri = isUri(documentOrUri) ? documentOrUri : documentOrUri.uri;
    return uri.scheme.includes(NotebookCellScheme);
}

export function isUntitledFile(file?: Uri) {
    return file?.scheme === 'untitled';
}
