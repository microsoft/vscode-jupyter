// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { BaseError } from '../../platform/errors/types';

/**
 * Thrown when the password provided for a Jupyter Uri is incorrect.
 */
export class JupyterInvalidPasswordError extends BaseError {
    constructor() {
        super('jupyterpassword', DataScience.passwordFailure);
    }
}
