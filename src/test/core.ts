// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// File without any dependencies on VS Code.

export async function sleep(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

// eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
export function noop() {}

export const isWindows = /^win/.test(process.platform);
