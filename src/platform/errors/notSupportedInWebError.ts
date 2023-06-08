// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BaseError } from './types';
import * as localize from '../common/utils/localize';

/**
 * Error thrown when we attempt to do something that is not supported in the web
 *
 * Cause:
 * This should be a bug in our code. Right now this is thrown if we try to start a 'local' jupyter server.
 *
 * Handled by:
 * Error should show up in the first cell.
 */
export class NotSupportedInWebError extends BaseError {
    constructor() {
        super('nodeonly', localize.DataScience.webNotSupported);
    }
}
