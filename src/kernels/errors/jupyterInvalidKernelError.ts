// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown when kernel cannot be used & we have no idea why (applies to non-zmq cases).
 *
 * Cause:
 * Jupyter [session](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.session.html) was disposed while we were waiting for idle.
 * This might happen if the kernel crashes during wait for idle.
 *
 * Handled by:
 * User should be shown this in the executing cell (if there is one), otherwise a notification will pop up. User is asked to look in the output
 * tab for more information (hopefully the reason the kernel died).
 */
export class JupyterInvalidKernelError extends BaseKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super(
            'invalidkernel',
            DataScience.kernelInvalid(getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)),
            kernelConnectionMetadata
        );
    }
}
