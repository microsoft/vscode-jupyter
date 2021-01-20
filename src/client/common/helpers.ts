// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ModuleNotInstalledError } from './errors/moduleNotInstalledError';
import { IDisposable } from './types';

export function isNotInstalledError(error: Error): boolean {
    const isError = typeof error === 'object' && error !== null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorObj = <any>error;
    if (!isError) {
        return false;
    }
    if (error instanceof ModuleNotInstalledError) {
        return true;
    }

    const isModuleNoInstalledError = error.message.indexOf('No module named') >= 0;
    return errorObj.code === 'ENOENT' || errorObj.code === 127 || isModuleNoInstalledError;
}

export function disposeAllDisposables(disposables: IDisposable[] = []) {
    while (disposables.length) {
        const disposable = disposables.shift();
        if (disposable) {
            disposable.dispose();
        }
    }
}
