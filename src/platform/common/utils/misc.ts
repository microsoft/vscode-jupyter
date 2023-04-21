// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TextDocument, Uri } from 'vscode';
import { InteractiveInputScheme, NotebookCellScheme } from '../constants';
import { InterpreterUri, Resource } from '../types';
import { isPromise } from './async';
import { StopWatch } from './stopWatch';

// eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
export function noop() {}

/**
 * Execute a block of code ignoring any exceptions.
 */
export function swallowExceptions(cb: Function) {
    try {
        const result = cb();
        if (isPromise(result)) {
            result.catch(noop);
        }
    } catch {
        // Ignore errors.
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

/**
 * Converts a union type to intersection
 * Courtesy of https://stackoverflow.com/questions/50374908/transform-union-type-to-intersection-type
 *
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
export type PickType<T, Value> = {
    [P in keyof T as T[P] extends Value ? P : never]: T[P];
};
export type ExcludeType<T, Value> = {
    [P in keyof T as T[P] extends Value ? never : P]: T[P];
};

// Information about a traced function/method call.
export type TraceInfo =
    | {
          elapsed: number; // milliseconds
          // Either returnValue or err will be set.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          returnValue?: any;
          err?: Error;
      }
    | undefined;

// Call run(), call log() with the trace info, and return the result.
export function tracing<T>(log: (t: TraceInfo) => void, run: () => T, logBeforeCall?: boolean): T {
    const timer = new StopWatch();
    try {
        if (logBeforeCall) {
            log(undefined);
        }
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
    return uri.scheme.includes(NotebookCellScheme) || uri.scheme.includes(InteractiveInputScheme);
}

export function isWeb() {
    return process.platform.toString() === 'web'; // Webpack is modifying this to force this to happen
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonStringifyUriReplacer(_key: string, value: any) {
    if (isUri(value)) {
        return value.toString();
    }
    return value;
}
/**
 * Compares contents of two objects that could contains Uris.
 * Returns `true` if both are the same, `false` otherwise.
 */
export function areObjectsWithUrisTheSame(obj1?: unknown, obj2?: unknown) {
    if (obj1 === obj2) {
        return true;
    }
    if (obj1 && !obj2) {
        return false;
    }
    return JSON.stringify(obj1, jsonStringifyUriReplacer) === JSON.stringify(obj2, jsonStringifyUriReplacer);
}
