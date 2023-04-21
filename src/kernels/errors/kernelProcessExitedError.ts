// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KernelConnectionMetadata } from '../types';
import { DataScience } from '../../platform/common/utils/localize';
import { BaseKernelError } from './types';

/**
 * Thrown when a raw kernel exits unexpectedly.
 */
export class KernelProcessExitedError extends BaseKernelError {
    constructor(
        public readonly exitCode: number = -1,
        public override readonly stdErr: string,
        kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super('kerneldied', DataScience.kernelDied(stdErr.trim()), kernelConnectionMetadata);
    }
}
