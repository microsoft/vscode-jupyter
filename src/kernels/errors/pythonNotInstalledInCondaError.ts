// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { LocalKernelConnectionMetadata } from '../types';
import { WrappedKernelError } from './types';

/**
 * Thrown when we attempt to start a kernel without Python installed in the corresponding Conda environment.
 */
export class PythonNotInstalledInCondaError extends WrappedKernelError {
    constructor(kernelConnectionMetadata: LocalKernelConnectionMetadata, originalException: Error | undefined) {
        super(
            DataScience.failedToStartKernelAsPythonIsNotInstalledInCondaEnv(
                getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata),
                kernelConnectionMetadata.interpreter?.envName || ''
            ),
            originalException,
            kernelConnectionMetadata
        );
    }
}
