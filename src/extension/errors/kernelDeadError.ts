// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../../client/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { KernelConnectionMetadata } from '../../kernels/types';
import { WrappedKernelError } from './types';

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
