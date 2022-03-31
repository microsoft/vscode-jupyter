// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

export class SessionDisposedError extends BaseError {
    constructor() {
        super('sessionDisposed', DataScience.sessionDisposed());
    }
}
