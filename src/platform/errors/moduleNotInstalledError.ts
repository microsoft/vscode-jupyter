// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from './types';

/**
 * Error thrown when we can't find a module during execing a module
 */
export class ModuleNotInstalledError extends BaseError {
    constructor(public readonly moduleName: string) {
        super('notinstalled', `Module '${moduleName}' not installed.`);
    }
}
