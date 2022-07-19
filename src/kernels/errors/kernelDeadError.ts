// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { KernelConnectionMetadata } from '../types';
import { WrappedKernelError } from './types';

/**
 * Thrown when a kernel dies during restart.
 */
export class KernelDeadError extends WrappedKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super(
            DataScience.kernelDiedWithoutError().format(
                getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)
            ),
            undefined,
            kernelConnectionMetadata
        );
    }
}
