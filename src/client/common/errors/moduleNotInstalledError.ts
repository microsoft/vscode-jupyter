// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '.';

export class ModuleNotInstalledError extends BaseError {
    constructor(moduleName: string) {
        super('notinstalled', `Module '${moduleName}' not installed.`);
    }
}
