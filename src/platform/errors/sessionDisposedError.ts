// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { BaseError } from './types';

/**
 * Error thrown when we attempt to use a jupyter session but it's already been shutdown.
 *
 * Cause:
 * Jupyter [session](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.session.html) was disposed or shutdown (usually from closing a notebook) and
 * then used again after that point. Generally if we're seeing this in a user log, there's a bug in the code.
 *
 * Handled by:
 * User should be shown this in the executing cell (if there is one), otherwise a notification will pop up.
 */
export class SessionDisposedError extends BaseError {
    constructor() {
        super('sessionDisposed', DataScience.sessionDisposed);
    }
}
