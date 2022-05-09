// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from './types';

export class JupyterExpiredCertsError extends BaseError {
    constructor(message: string) {
        super('jupyterexpiredcert', message);
    }
}
