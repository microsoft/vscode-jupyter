// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from '../../common/errors';

export class JupyterZMQBinariesNotFoundError extends BaseError {
    constructor(message: string) {
        super('zmq', message);
    }
}
