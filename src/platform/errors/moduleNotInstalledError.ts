// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseError } from './types';

/**
 * Error thrown when we can't find a module during execing a module
 *
 * Cause:
 * PythonProcessService is being used to exec a module, but we can't find the module.
 *
 * Handled by:
 * The task needing the module will handle it.
 *
 */
export class ModuleNotInstalledError extends BaseError {
    constructor(public readonly moduleName: string) {
        super('notinstalled', `Module '${moduleName}' not installed.`);
    }
}
