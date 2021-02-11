// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseError } from '../../common/errors/types';
import * as localize from '../../common/utils/localize';

export class JupyterDataRateLimitError extends BaseError {
    constructor() {
        super('unknown', localize.DataScience.jupyterDataRateExceeded());
    }
}
