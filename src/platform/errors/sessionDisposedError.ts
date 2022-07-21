// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

/**
 * Error thrown when we attempt to use a jupyter session but it's already been shutdown.
 */
export class SessionDisposedError extends BaseError {
    constructor() {
        super('sessionDisposed', DataScience.sessionDisposed());
    }
}
