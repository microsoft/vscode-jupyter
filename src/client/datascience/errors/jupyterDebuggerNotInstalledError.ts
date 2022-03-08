// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseKernelError } from '../../common/errors/types';
import '../../common/extensions';
import * as localize from '../../common/utils/localize';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';

export class JupyterDebuggerNotInstalledError extends BaseKernelError {
    constructor(debuggerPkg: string, message: string | undefined, kernelConnectionMetadata: KernelConnectionMetadata) {
        const errorMessage = message
            ? message
            : localize.DataScience.jupyterDebuggerNotInstalledError().format(debuggerPkg);
        super('notinstalled', errorMessage, kernelConnectionMetadata);
    }
}
