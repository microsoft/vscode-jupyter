// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { KernelConnectionMetadata } from '../../kernels/types';
import { BaseKernelError } from './types';

export class KernelProcessExitedError extends BaseKernelError {
    constructor(
        public readonly exitCode: number = -1,
        public override readonly stdErr: string,
        kernelConnectionMetadata: KernelConnectionMetadata,
        message: string = ''
    ) {
        super(
            'kerneldied',
            message || 'Kernel Died Don with stack' + (new Error('').stack || ''),
            kernelConnectionMetadata
        );
    }
}
