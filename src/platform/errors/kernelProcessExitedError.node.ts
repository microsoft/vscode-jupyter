// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../common/utils/localize';
import { KernelConnectionMetadata } from '../../kernels/types';
import { BaseKernelError } from './types';

export class KernelProcessExitedError extends BaseKernelError {
    constructor(
        public readonly exitCode: number = -1,
        public readonly stdErr: string,
        kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super('kerneldied', DataScience.kernelDied().format(stdErr.trim()), kernelConnectionMetadata);
    }
}
