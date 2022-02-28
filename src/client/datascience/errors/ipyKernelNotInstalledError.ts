// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../common/errors/types';
import { traceError } from '../../common/logger';
import { KernelInterpreterDependencyResponse } from '../types';

export class IpyKernelNotInstalledError extends BaseError {
    /**
     * @param {boolean} selectAnotherKernel Whether the user chose to use another kernel.
     */
    constructor(
        message: string,
        public reason: KernelInterpreterDependencyResponse,
        public readonly selectAnotherKernel: boolean
    ) {
        super('noipykernel', message);
        traceError(`IPykernel not detected`);
    }
}
