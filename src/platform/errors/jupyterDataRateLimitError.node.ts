// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

export class JupyterDataRateLimitError extends BaseError {
    constructor() {
        super('unknown', DataScience.jupyterDataRateExceeded());
    }
}
