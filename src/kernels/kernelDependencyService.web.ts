// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { Resource, IDisplayOptions } from '../platform/common/types';
import { IKernelDependencyService, KernelConnectionMetadata, KernelInterpreterDependencyResponse } from './types';

/**
 * Responsible for managing dependencies of a Python interpreter required to run as a Jupyter Kernel.
 * If required modules aren't installed, will prompt user to install them.
 */
@injectable()
export class KernelDependencyService implements IKernelDependencyService {
    public async installMissingDependencies(_options: {
        resource: Resource;
        kernelConnection: KernelConnectionMetadata;
        ui: IDisplayOptions;
        token: CancellationToken;
        ignoreCache?: boolean;
        cannotChangeKernels?: boolean;
        installWithoutPrompting?: boolean;
    }): Promise<KernelInterpreterDependencyResponse> {
        return KernelInterpreterDependencyResponse.cancel;
    }
    public async areDependenciesInstalled(
        _kernelConnection: KernelConnectionMetadata,
        _token?: CancellationToken,
        _ignoreCache?: boolean
    ): Promise<boolean> {
        return false;
    }
}
