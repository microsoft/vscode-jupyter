// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, CancellationToken, CancellationTokenSource } from 'vscode';
import { disposeAllDisposables } from './helpers';
import { IDisposable } from './types';
import { isPromiseLike } from './utils/async';
import { Common } from './utils/localize';

export function isCancellationError(ex: Error, includeErrorsWithTheMessageCanceled = false) {
    if (typeof ex !== 'object' || !ex) {
        return false;
    }
    if (ex instanceof CancellationError) {
        return true;
    }
    if (
        includeErrorsWithTheMessageCanceled &&
        (ex.message.includes('Canceled') || ex.message.includes(Common.canceled))
    ) {
        return true;
    }
    return false;
}

export async function raceCancellation<T>(
    token: CancellationToken | undefined,
    ...promises: Promise<T>[]
): Promise<T | undefined>;
export async function raceCancellation<T>(
    token: CancellationToken | undefined,
    defaultValue: T,
    ...promises: Promise<T>[]
): Promise<T>;
export async function raceCancellation<T>(
    token: CancellationToken | undefined,
    defaultValue: T,
    ...promises: Promise<T>[]
): Promise<T | undefined> {
    if (!token) {
        return Promise.race(promises);
    }
    let value: T | undefined;
    if (isPromiseLike(defaultValue)) {
        promises.push(defaultValue as unknown as Promise<T>);
        value = undefined;
    } else {
        value = defaultValue;
    }
    if (token.isCancellationRequested) {
        return value;
    }

    return new Promise((resolve, reject) => {
        if (token.isCancellationRequested) {
            return resolve(value);
        }
        const disposable = token.onCancellationRequested(() => {
            disposable.dispose();
            resolve(value);
        });
        Promise.race(promises)
            .then(resolve, reject)
            .finally(() => disposable.dispose());
    });
}
export async function raceCancellationError<T>(token?: CancellationToken, ...promises: Promise<T>[]): Promise<T> {
    if (!token) {
        return Promise.race(promises);
    }
    if (token.isCancellationRequested) {
        throw new CancellationError();
    }

    return new Promise((resolve, reject) => {
        if (token.isCancellationRequested) {
            return reject(new CancellationError());
        }
        const disposable = token.onCancellationRequested(() => {
            disposable.dispose();
            reject(new CancellationError());
        });
        Promise.race(promises)
            .then(resolve, reject)
            .finally(() => disposable.dispose());
    });
}

/**
 * Create a single unified cancellation token that wraps multiple cancellation tokens.
 */
export function wrapCancellationTokens(...tokens: CancellationToken[]) {
    const wrappedCancellationToken = new CancellationTokenSource();
    const disposables: IDisposable[] = [];
    for (const token of tokens) {
        if (!token) {
            continue;
        }
        if (token.isCancellationRequested) {
            wrappedCancellationToken.cancel();
        }
        token.onCancellationRequested(() => wrappedCancellationToken.cancel(), undefined, disposables);
    }
    const oldDispose = wrappedCancellationToken.dispose.bind(wrappedCancellationToken);
    wrappedCancellationToken.dispose = () => {
        oldDispose();
        disposeAllDisposables(disposables);
    };
    return wrappedCancellationToken;
}

export namespace Cancellation {
    /**
     * throws a CancellationError if the token is canceled.
     * @param cancelToken
     */
    export function throwIfCanceled(cancelToken?: CancellationToken): void {
        if (cancelToken?.isCancellationRequested) {
            throw new CancellationError();
        }
    }
}
