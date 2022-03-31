// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { DataScience } from '../common/utils/localize';
import { KernelConnectionMetadata } from '../../kernels/types';
import { BaseKernelError } from './types';

export class JupyterDebuggerNotInstalledError extends BaseKernelError {
    constructor(debuggerPkg: string, message: string | undefined, kernelConnectionMetadata: KernelConnectionMetadata) {
        const errorMessage = message ? message : DataScience.jupyterDebuggerNotInstalledError().format(debuggerPkg);
        super('notinstalled', errorMessage, kernelConnectionMetadata);
    }
}
