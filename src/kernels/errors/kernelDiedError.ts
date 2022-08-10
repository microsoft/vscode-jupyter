// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KernelConnectionMetadata } from '../types';
import { WrappedKernelError } from './types';

/***
 * Thrown when a kernel dies during startup
 *
 * Cause:
 * A raw kernel failed to start. Usually some sort of import problem.
 *
 * Handled by:
 * Showing the stderr of the kernel in the first cell.
 */
export class KernelDiedError extends WrappedKernelError {
    constructor(
        message: string,
        public override readonly stdErr: string,
        originalException: Error | undefined,
        kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super(message, originalException, kernelConnectionMetadata);
    }
}
