// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import '../../platform/common/extensions';
import { traceVerbose, logValue, ignoreLogging } from '../../platform/logging';
import { Resource, IDisplayOptions } from '../../platform/common/types';
import { KernelConnectionMetadata } from '../types';
import { IJupyterKernelService } from './types';

/**
 * Responsible for registering and updating kernels in a web situation
 *
 * @export
 * @class JupyterKernelService
 */
@injectable()
export class JupyterKernelService implements IJupyterKernelService {
    /**
     * Makes sure that the kernel pointed to is a valid jupyter kernel (it registers it) and
     * that is up to date relative to the interpreter that it might contain
     * @param resource
     * @param kernel
     */
    public async ensureKernelIsUsable(
        _resource: Resource,
        @logValue<KernelConnectionMetadata>('id') _kernel: KernelConnectionMetadata,
        @logValue<IDisplayOptions>('disableUI') _ui: IDisplayOptions,
        @ignoreLogging() _cancelToken: CancellationToken,
        _cannotChangeKernels?: boolean
    ): Promise<void> {
        traceVerbose('Check if a kernel is usable');
        // For now web kernels are always usable.
    }
}
