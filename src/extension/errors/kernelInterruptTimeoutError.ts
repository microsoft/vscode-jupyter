// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseKernelError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';
import { KernelConnectionMetadata } from '../../../kernels/types';

export class KernelInterruptTimeoutError extends BaseKernelError {
    constructor(kernelConnection: KernelConnectionMetadata) {
        super('kernelpromisetimeout', DataScience.interruptingKernelFailed(), kernelConnection);
    }
}
