// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { DataScience } from '../../platform/common/utils/localize';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { LocalKernelConnectionMetadata } from '../types';
import { WrappedKernelError } from './types';

/**
 * Thrown when we attempt to start a kernel that is not trusted.
 */
export class KernelSpecNotTrustedError extends WrappedKernelError {
    constructor(kernelConnectionMetadata: LocalKernelConnectionMetadata) {
        super(
            DataScience.failedToStartAnUntrustedKernelSpec().format(
                getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata),
                kernelConnectionMetadata.kernelSpec.specFile
                    ? getDisplayPath(Uri.file(kernelConnectionMetadata.kernelSpec.specFile))
                    : ''
            ),
            undefined,
            kernelConnectionMetadata
        );
    }
}
