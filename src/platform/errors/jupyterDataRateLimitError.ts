// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

/**
 * Error thrown when the jupyter iopub datarate limit is exceeded. This can happen when the jupyter config is not created by us (user can force this to happen with a setting)
 */
export class JupyterDataRateLimitError extends BaseError {
    constructor() {
        super('unknown', DataScience.jupyterDataRateExceeded());
    }
}
