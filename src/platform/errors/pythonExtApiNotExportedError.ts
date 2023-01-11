// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseError } from './types';

export class PythonExtensionApiNotExportedError extends BaseError {
    constructor() {
        super('pythonExtension', 'Python Extension API not exported');
    }
}
