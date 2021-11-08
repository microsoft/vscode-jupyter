// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';

export class KernelInterruptTimeoutError extends BaseError {
    constructor(public readonly kernelConnection: KernelConnectionMetadata) {
        super('kernelpromisetimeout', DataScience.interruptingKernelFailed());
    }
}
