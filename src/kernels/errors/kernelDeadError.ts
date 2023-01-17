// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { KernelConnectionMetadata } from '../types';
import { WrappedKernelError } from './types';

/**
 * Thrown when a kernel dies during restart.
 *
 * Cause:
 * Kernel dies during restart. This can happen if the code that caused the restart is still loading (like as a startup command or an implicit import).
 *
 * Handled by:
 * Controller sticking this error in the cell it's trying to run. It should point the user to https://aka.ms/vscodeJupyterKernelCrash for more information.
 */
export class KernelDeadError extends WrappedKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super(
            DataScience.kernelDiedWithoutError(getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)),
            undefined,
            kernelConnectionMetadata
        );
    }
}
