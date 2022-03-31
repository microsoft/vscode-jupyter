// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { DataScience } from '../common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers.node';
import { KernelConnectionMetadata, KernelInterpreterDependencyResponse } from '../../kernels/types';
import { BaseKernelError } from './types';

export class JupyterKernelDependencyError extends BaseKernelError {
    constructor(
        public reason: KernelInterpreterDependencyResponse,
        kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super(
            'noipykernel',
            DataScience.kernelInvalid().format(getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)),
            kernelConnectionMetadata
        );
    }
}
