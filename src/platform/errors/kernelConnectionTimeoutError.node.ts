// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize.node';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers.node';
import { KernelConnectionMetadata } from '../../kernels/types';
import { BaseKernelError } from './types';

export class KernelConnectionTimeoutError extends BaseKernelError {
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
