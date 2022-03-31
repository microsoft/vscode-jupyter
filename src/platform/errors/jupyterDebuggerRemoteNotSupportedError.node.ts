// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { DataScience } from '../common/utils/localize';
import { KernelConnectionMetadata } from '../../kernels/types';
import { BaseKernelError } from './types';

export class JupyterDebuggerRemoteNotSupportedError extends BaseKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super('debugger', DataScience.remoteDebuggerNotSupported(), kernelConnectionMetadata);
    }
}
