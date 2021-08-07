// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { BaseError } from '../../../common/errors/types';

export class JupyterKernelPromiseFailedError extends BaseError {
    constructor(message: string) {
        super('kernelpromisetimeout', message);
    }
}
