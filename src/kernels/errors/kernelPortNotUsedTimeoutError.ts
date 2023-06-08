// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown if we cannot get a port for connecting to a raw kernel.
 */
export class KernelPortNotUsedTimeoutError extends BaseKernelError {
    constructor(kernelConnection: KernelConnectionMetadata) {
        super(
            'timeout',
            DataScience.rawKernelStartFailedDueToTimeoutWaitingForPort(
                getDisplayNameOrNameOfKernelConnection(kernelConnection)
            ),
            kernelConnection
        );
    }
}
