// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { BaseKernelError } from '../../common/errors/types';
import { DataScience } from '../../common/utils/localize';
import { KernelInterpreterDependencyResponse } from '../types';
import { getDisplayNameOrNameOfKernelConnection } from '../../../kernels/helpers';
import { KernelConnectionMetadata } from '../../../kernels/types';

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
