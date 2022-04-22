// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { KernelConnectionMetadata } from '../../kernels/types';
import { BaseKernelError } from './types';

export class KernelInterruptTimeoutError extends BaseKernelError {
    constructor(kernelConnection: KernelConnectionMetadata) {
        super('kernelpromisetimeout', DataScience.interruptingKernelFailed(), kernelConnection);
    }
}
