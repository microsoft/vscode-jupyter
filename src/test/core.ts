// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IDisposable } from '../platform/common/types';

// File without any dependencies on VS Code.

export async function sleep(milliseconds: number, disposables?: IDisposable[]) {
    return new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, milliseconds);
        if (disposables) {
            disposables.push({ dispose: () => clearTimeout(timeout) });
        }
    });
}

// eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
export function noop() {}
