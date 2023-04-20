// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown when a raw kernel times out trying to connect to one of its ports.
 *
 * Cause:
 * Raw kernel timed out trying to connect to one of its ports. Might be the port is in use or the kernel is hung.
 *
 * Handled by:
 * Showing a message in the first cell.
 */
export class KernelConnectionTimeoutError extends BaseKernelError {
    constructor(kernelConnection: KernelConnectionMetadata) {
        super(
            'timeout',
            DataScience.rawKernelStartFailedDueToTimeout(getDisplayNameOrNameOfKernelConnection(kernelConnection)),
            kernelConnection
        );
    }
}
