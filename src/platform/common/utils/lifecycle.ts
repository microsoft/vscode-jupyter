// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, EventEmitter } from '@c4312/evt';
import { IDisposable } from '../types';
import { once } from './functional';
import { Iterable } from './iterable';

let disposableTracker: IDisposable[] | null = null;

export function setDisposableTracker(tracker: IDisposable[] | null): void {
    disposableTracker = tracker;
}

export function trackDisposable<T extends IDisposable>(x: T): T {
    disposableTracker?.push(x);
    return x;
}

/**
 * Disposes of the value(s) passed in.
 */
export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(disposable: T | undefined): T | undefined;
export function dispose<T extends IDisposable, A extends Iterable<T> = Iterable<T>>(disposables: A): A;
export function dispose<T extends IDisposable>(disposables: Array<T>): Array<T>;
export function dispose<T extends IDisposable>(disposables: ReadonlyArray<T>): ReadonlyArray<T>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispose<T extends IDisposable>(arg: T | Iterable<T> | undefined): any {
    if (Iterable.is(arg)) {
        for (const d of arg) {
            if (d) {
                try {
                    d.dispose();
                } catch (e) {
                    console.warn(`dispose() failed for ${d}`, e);
                }
            }
        }

        return Array.isArray(arg) ? [] : arg;
    } else if (arg) {
        arg.dispose();
        return arg;
    }
}

/**
 * Combine multiple disposable values into a single {@link IDisposable}.
 */
export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
    return toDisposable(() => dispose(disposables));
}

/**
 * Turn a function that implements dispose into an {@link IDisposable}.
 *
 * @param fn Clean up function, guaranteed to be called only **once**.
 */
function toDisposable(fn: () => void): IDisposable {
    const self = trackDisposable({
        dispose: once(() => fn())
    });
    return self;
}

/**
 * Manages a collection of disposable values.
 *
 * This is the preferred way to manage multiple disposables. A `DisposableStore` is safer to work with than an
 * `IDisposable[]` as it considers edge cases, such as registering the same value multiple times or adding an item to a
 * store that has already been disposed of.
 */
export class DisposableStore implements IDisposable {
    static DISABLE_DISPOSED_WARNING = false;

    private readonly _toDispose = new Set<IDisposable>();
    private _isDisposed = false;

    constructor(...disposables: IDisposable[]) {
        disposables.forEach((disposable) => this.add(disposable));
        trackDisposable(this);
    }

    /**
     * Dispose of all registered disposables and mark this object as disposed.
     *
     * Any future disposables added to this object will be disposed of on `add`.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this.clear();
    }

    /**
     * @return `true` if this object has been disposed of.
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Dispose of all registered disposables but do not mark this object as disposed.
     */
    public clear(): void {
        if (this._toDispose.size === 0) {
            return;
        }

        try {
            dispose(this._toDispose);
        } finally {
            this._toDispose.clear();
        }
    }

    /**
     * Add a new {@link IDisposable disposable} to the collection.
     */
    public add<T extends IDisposable>(o: T): T {
        if (!o) {
            return o;
        }
        if ((o as unknown as DisposableStore) === this) {
            throw new Error('Cannot register a disposable on itself!');
        }

        if (this._isDisposed) {
            if (!DisposableStore.DISABLE_DISPOSED_WARNING) {
                console.warn(
                    new Error(
                        'Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!'
                    ).stack
                );
            }
        } else {
            this._toDispose.add(o);
        }

        return o;
    }
}

/**
 * Abstract class for a {@link IDisposable disposable} object.
 *
 * Subclasses can {@linkcode _register} disposables that will be automatically cleaned up when this object is disposed of.
 */
export abstract class DisposableBase implements IDisposable {
    protected readonly _store = new DisposableStore();
    private _isDisposed: boolean = false;

    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    constructor(...disposables: IDisposable[]) {
        disposables.forEach((disposable) => this._store.add(disposable));
        trackDisposable(this);
    }

    public dispose(): void {
        this._store.dispose();
        this._isDisposed = true;
    }

    /**
     * Adds `o` to the collection of disposables managed by this object.
     */
    protected _register<T extends IDisposable>(o: T): T {
        if ((o as unknown as DisposableBase) === this) {
            throw new Error('Cannot register a disposable on itself!');
        }
        return this._store.add(o);
    }
}

/**
 * Abstract base class for a {@link IDisposable disposable} object.
 *
 * Subclasses can {@linkcode _register} disposables that will be automatically cleaned up when this object is disposed of.
 */
export abstract class ObservableDisposable extends DisposableBase {
    private readonly _onDidDispose: EventEmitter<void>;
    public readonly onDidDispose: Event<void>;

    constructor() {
        super();
        this._onDidDispose = new EventEmitter<void>();
        this.onDidDispose = this._onDidDispose.event;
    }

    override dispose() {
        super.dispose();
        this._onDidDispose.fire();
        this._onDidDispose.dispose();
    }
}

export function disposeOnReturn(fn: (store: DisposableStore) => void): void {
    const store = new DisposableStore();
    try {
        fn(store);
    } finally {
        store.dispose();
    }
}

/**
 * A map the manages the lifecycle of the values that it stores.
 */
export class DisposableMap<K, V extends IDisposable = IDisposable> implements IDisposable {
    private readonly _store = new Map<K, V>();
    private _isDisposed = false;
    /**
     * Disposes of all stored values and mark this object as disposed.
     *
     * Trying to use this object after it has been disposed of is an error.
     */
    dispose(): void {
        this._isDisposed = true;
        this.clearAndDisposeAll();
    }

    /**
     * Disposes of all stored values and clear the map, but DO NOT mark this object as disposed.
     */
    clearAndDisposeAll(): void {
        if (!this._store.size) {
            return;
        }

        try {
            dispose(this._store.values());
        } finally {
            this._store.clear();
        }
    }

    has(key: K): boolean {
        return this._store.has(key);
    }

    get(key: K): V | undefined {
        return this._store.get(key);
    }

    set(key: K, value: V, skipDisposeOnOverwrite = false): void {
        if (this._isDisposed) {
            console.warn(
                new Error(
                    'Trying to add a disposable to a DisposableMap that has already been disposed of. The added object will be leaked!'
                ).stack
            );
        }

        if (!skipDisposeOnOverwrite) {
            this._store.get(key)?.dispose();
        }

        this._store.set(key, value);
    }

    /**
     * Delete the value stored for `key` from this map and also dispose of it.
     */
    deleteAndDispose(key: K): void {
        this._store.get(key)?.dispose();
        this._store.delete(key);
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this._store[Symbol.iterator]();
    }
}
