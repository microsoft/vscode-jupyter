// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource, Disposable } from 'vscode';

export interface CacheResult<T> extends Disposable {
    promise: Promise<T>;
}

export class Cache<T> {
    private result: CacheResult<T> | null = null;
    constructor(private task: (ct: CancellationToken) => Promise<T>) {}

    get(): CacheResult<T> {
        if (this.result) {
            return this.result;
        }

        const cts = new CancellationTokenSource();
        const promise = this.task(cts.token);

        this.result = {
            promise,
            dispose: () => {
                this.result = null;
                cts.cancel();
                cts.dispose();
            }
        };

        return this.result;
    }
}

/**
 * Uses a LRU cache to make a given parametrized function cached.
 * Caches just the last value.
 * The key must be JSON serializable.
 */
export class LRUCachedComputed<TArg, TComputed> {
    private lastCache: TComputed | undefined = undefined;
    private lastArgKey: string | undefined = undefined;

    constructor(private readonly computeFn: (arg: TArg) => TComputed) {}

    public get(arg: TArg): TComputed {
        const key = JSON.stringify(arg);
        if (this.lastArgKey !== key) {
            this.lastArgKey = key;
            this.lastCache = this.computeFn(arg);
        }
        return this.lastCache!;
    }
}
