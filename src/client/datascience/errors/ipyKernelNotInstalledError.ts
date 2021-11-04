// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../common/errors/types';
import { KernelInterpreterDependencyResponse } from '../types';

export class IpyKernelNotInstalledError extends BaseError {
    constructor(message: string, public reason: KernelInterpreterDependencyResponse) {
        super('noipykernel', message);
    }
}
