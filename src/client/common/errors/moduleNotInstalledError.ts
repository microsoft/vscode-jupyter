// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from './types';

export class ModuleNotInstalledError extends BaseError {
    constructor(public readonly moduleName: string) {
        super('notinstalled', `Module '${moduleName}' not installed.`);
    }
}
