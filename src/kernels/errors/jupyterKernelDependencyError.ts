// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { KernelConnectionMetadata, KernelInterpreterDependencyResponse } from '../types';
import { BaseKernelError } from './types';

/**
 * Control flow exception to indicate a dependency is missing in a kernel
 */
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
