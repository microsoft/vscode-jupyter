// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { KernelConnectionMetadata } from '../types';
import { WrappedKernelError } from './types';

/***
 * Thrown when a kernel dies during startup
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
