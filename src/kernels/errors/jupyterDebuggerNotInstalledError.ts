// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { DataScience } from '../../platform/common/utils/localize';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown when debugpy cannot be loaded into the kernel.
 *
 * Cause:
 * InteractiveWindow tries to inject debugpy and have it listen on a port. When the executeSilently fails or a port is not returned, this error is thrown.
 *
 * Handled by:
 * Error is shown in the cell the user is trying to debug.
 */
export class JupyterDebuggerNotInstalledError extends BaseKernelError {
    constructor(debuggerPkg: string, message: string | undefined, kernelConnectionMetadata: KernelConnectionMetadata) {
        const errorMessage = message ? message : DataScience.jupyterDebuggerNotInstalledError(debuggerPkg);
        super('notinstalled', errorMessage, kernelConnectionMetadata);
    }
}
