// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize.node';
import { BaseError } from './types';

export class SessionDisposedError extends BaseError {
    constructor() {
        super('sessionDisposed', DataScience.sessionDisposed());
    }
}
