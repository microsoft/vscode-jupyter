// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { BaseKernelError } from '../../common/errors/types';
import '../../common/extensions';
import * as localize from '../../common/utils/localize';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';

export class JupyterDebuggerRemoteNotSupportedError extends BaseKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super('debugger', localize.DataScience.remoteDebuggerNotSupported(), kernelConnectionMetadata);
    }
}
