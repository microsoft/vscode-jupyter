// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { KernelConnectionMetadata } from '../../kernels/types';
import { DataScience } from '../common/utils/localize';
import { BaseKernelError } from './types';

export class KernelProcessExitedError extends BaseKernelError {
    constructor(
        public readonly exitCode: number = -1,
        public override readonly stdErr: string,
        kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super('kerneldied', DataScience.kernelDied().format(stdErr.trim()), kernelConnectionMetadata);
    }
}
