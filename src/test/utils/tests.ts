// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function testN(name: string, n: number, fn: () => unknown): void {
    for (let i = 0; i < n; i += 1) {
        test(`${name} - ${i + 1}`, fn);
    }
}
