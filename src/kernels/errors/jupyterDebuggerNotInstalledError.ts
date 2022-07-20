// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { DataScience } from '../../platform/common/utils/localize';
import { KernelConnectionMetadata } from '../types';
import { BaseKernelError } from './types';

/**
 * Thrown when debugpy cannot be loaded into the kernel.
 */
export class JupyterDebuggerNotInstalledError extends BaseKernelError {
    constructor(debuggerPkg: string, message: string | undefined, kernelConnectionMetadata: KernelConnectionMetadata) {
        const errorMessage = message ? message : DataScience.jupyterDebuggerNotInstalledError().format(debuggerPkg);
        super('notinstalled', errorMessage, kernelConnectionMetadata);
    }
}
