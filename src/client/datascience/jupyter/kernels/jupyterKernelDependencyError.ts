// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { BaseError } from '../../../common/errors/types';
import { DataScience } from '../../../common/utils/localize';
import { KernelInterpreterDependencyResponse } from '../../types';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { KernelConnectionMetadata } from './types';

export class JupyterKernelDependencyError extends BaseError {
    constructor(
        public reason: KernelInterpreterDependencyResponse,
        kernelConnectionMetadata: KernelConnectionMetadata
    ) {
        super(
            'noipykernel',
            DataScience.kernelInvalid().format(getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata))
        );
    }
}
