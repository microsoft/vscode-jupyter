// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { KernelConnectionMetadata } from '../../kernels/types';
import { WrappedKernelError } from './types';

export class KernelDiedError extends WrappedKernelError {
    constructor(
        message: string,
        public readonly stdErr: string,
        originalException: Error | undefined,
        kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super(message, originalException, kernelConnectionMetadata);
    }
}
