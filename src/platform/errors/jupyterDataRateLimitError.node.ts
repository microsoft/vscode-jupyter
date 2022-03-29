// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { DataScience } from '../../platform/common/utils/localize.node';
import { BaseError } from './types';

export class JupyterDataRateLimitError extends BaseError {
    constructor() {
        super('unknown', DataScience.jupyterDataRateExceeded());
    }
}
