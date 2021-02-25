// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../../common/errors/types';

export class KernelSpecNotFoundError extends BaseError {
    constructor() {
        super('kernelspecnotfound', 'Failed to find a kernelspec to use for ipykernel launch');
    }
}
