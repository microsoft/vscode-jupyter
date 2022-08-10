// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { IDisposable } from './types';

export function disposeAllDisposables(disposables: IDisposable[] = []) {
    while (disposables.length) {
        const disposable = disposables.shift();
        if (disposable) {
            try {
                disposable.dispose();
            } catch {
                // Don't care.
            }
        }
    }
}
