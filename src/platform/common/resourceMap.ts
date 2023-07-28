// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';

interface ResourceMapKeyFn {
    (resource: Uri): string;
}

class ResourceMapEntry<T> {
    constructor(
        readonly Uri: Uri,
        readonly value: T
    ) {}
}

/**
 * Map that's keyed off a URI. Better than using a toString() as the key.
 */
export class ResourceMap<T> implements Map<Uri, T> {
    private static readonly defaultToKey = (resource: Uri) => resource.toString();

    readonly [Symbol.toStringTag] = 'ResourceMap';

    private readonly map: Map<string, ResourceMapEntry<T>>;
    private readonly toKey: ResourceMapKeyFn;

    /**
     *
     * @param toKey Custom Uri identity function, e.g use an existing `IExtUri#getComparison`-util
     */
    constructor(toKey?: ResourceMapKeyFn);

    /**
     *
     * @param other Another resource which this maps is created from
     * @param toKey Custom Uri identity function, e.g use an existing `IExtUri#getComparison`-util
     */
    constructor(other?: ResourceMap<T>, toKey?: ResourceMapKeyFn);

    constructor(mapOrKeyFn?: ResourceMap<T> | ResourceMapKeyFn, toKey?: ResourceMapKeyFn) {
        if (mapOrKeyFn instanceof ResourceMap) {
            this.map = new Map(mapOrKeyFn.map);
            this.toKey = toKey ?? ResourceMap.defaultToKey;
        } else {
            this.map = new Map();
            this.toKey = mapOrKeyFn ?? ResourceMap.defaultToKey;
        }
    }

    set(resource: Uri, value: T): this {
        this.map.set(this.toKey(resource), new ResourceMapEntry(resource, value));
        return this;
    }

    get(resource: Uri): T | undefined {
        return this.map.get(this.toKey(resource))?.value;
    }

    has(resource: Uri): boolean {
        return this.map.has(this.toKey(resource));
    }

    get size(): number {
        return this.map.size;
    }

    clear(): void {
        this.map.clear();
    }

    delete(resource: Uri): boolean {
        return this.map.delete(this.toKey(resource));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forEach(clb: (value: T, key: Uri, map: Map<Uri, T>) => void, thisArg?: any): void {
        if (typeof thisArg !== 'undefined') {
            clb = clb.bind(thisArg);
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for (let [_, entry] of this.map) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clb(entry.value, entry.Uri, <any>this);
        }
    }

    *values(): IterableIterator<T> {
        for (let entry of this.map.values()) {
            yield entry.value;
        }
    }

    *keys(): IterableIterator<Uri> {
        for (let entry of this.map.values()) {
            yield entry.Uri;
        }
    }

    *entries(): IterableIterator<[Uri, T]> {
        for (let entry of this.map.values()) {
            yield [entry.Uri, entry.value];
        }
    }

    *[Symbol.iterator](): IterableIterator<[Uri, T]> {
        for (let [, entry] of this.map) {
            yield [entry.Uri, entry.value];
        }
    }
}
