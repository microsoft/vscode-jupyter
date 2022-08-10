// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { KernelConnectionMetadata, KernelInterpreterDependencyResponse } from '../types';
import { BaseKernelError } from './types';

/**
 * Control flow exception to indicate a dependency is missing in a kernel.
 *
 * Cause:
 * User clicked the cancel button during installing dependencies into the kernel or a failure occurred during installation.
 *
 * Handled by:
 * Specific error message is shown in the cell telling the user how to fix the problem.
 */
export class JupyterKernelDependencyError extends BaseKernelError {
    constructor(
        public reason: KernelInterpreterDependencyResponse,
        kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super(
            'noipykernel',
            DataScience.kernelInvalid().format(getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)),
            kernelConnectionMetadata
        );
    }
}
