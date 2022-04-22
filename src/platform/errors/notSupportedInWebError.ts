// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from './types';
import * as localize from '../common/utils/localize';

export class NotSupportedInWebError extends BaseError {
    constructor() {
        super('nodeonly', localize.DataScience.webNotSupported());
    }
}
