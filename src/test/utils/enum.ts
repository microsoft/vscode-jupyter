// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

export function getNamesAndValues<T>(e: any): { name: string; value: T }[] {
    return getNames(e).map((n) => ({ name: n, value: e[n] }));
}

export function getNames(e: any) {
    return Object.keys(e).filter((v) => typeof v === 'string') as string[];
}
