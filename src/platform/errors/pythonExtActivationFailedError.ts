// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WrappedError } from './types';

export class PythonExtensionActicationFailedError extends WrappedError {
    constructor(originalException: Error) {
        super('Python Extension failed to activate', originalException, 'pythonExtension');
    }
}
