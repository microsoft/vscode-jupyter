// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';

export class SessionDisposedError extends BaseError {
    constructor() {
        super('sessionDisposed', DataScience.sessionDisposed());
    }
}
