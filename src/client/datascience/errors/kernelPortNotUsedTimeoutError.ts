// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { BaseKernelError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { KernelConnectionMetadata } from '../../../kernels/types';

export class KernelPortNotUsedTimeoutError extends BaseKernelError {
    constructor(kernelConnection: KernelConnectionMetadata) {
        super(
            'timeout',
            DataScience.rawKernelStartFailedDueToTimeout().format(
                getDisplayNameOrNameOfKernelConnection(kernelConnection)
            ),
            kernelConnection
        );
    }
}
