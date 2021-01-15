// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function getNamesAndValues<T>(e: any): { name: string; value: T }[] {
    return getNames(e).map((n) => ({ name: n, value: e[n] }));
}

export function getNames(e: any) {
    return Object.keys(e).filter((v) => typeof v === 'string') as string[];
}
