// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown when an interrupt takes too long.
 *
 * Cause:
 * The IKernelConnection.interrupt method takes longer than a minute.
 *
 * Handled by:
 * KernelExecution actually ignores this error and just turns it into a restart happened. That's because its own
 * interrupt has a timeout too. That timeout causes a timeout.
 */
export class KernelInterruptTimeoutError extends BaseKernelError {
    constructor(kernelConnection: KernelConnectionMetadata) {
        super('kernelpromisetimeout', DataScience.interruptingKernelFailed, kernelConnection);
    }
}
