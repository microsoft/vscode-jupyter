// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WrappedError } from './types';

export class PythonExtensionNotInstalledError extends WrappedError {
    constructor() {
        super('Python Extension not installed', undefined, 'pythonExtension');
    }
}
