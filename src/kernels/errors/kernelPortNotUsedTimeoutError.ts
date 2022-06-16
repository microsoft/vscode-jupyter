// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from '../../platform/errors/types';

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
