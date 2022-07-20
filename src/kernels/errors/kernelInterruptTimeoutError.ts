// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown when an interrupt takes too long.
 */
export class KernelInterruptTimeoutError extends BaseKernelError {
    constructor(kernelConnection: KernelConnectionMetadata) {
        super('kernelpromisetimeout', DataScience.interruptingKernelFailed(), kernelConnection);
    }
}
