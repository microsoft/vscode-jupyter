// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function sleep(timeout: number): Promise<number> {
    return new Promise<number>((resolve) => {
        setTimeout(() => resolve(timeout), timeout);
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPromise<T>(v: any): v is Promise<T> {
    return typeof v?.then === 'function' && typeof v?.catch === 'function';
}
