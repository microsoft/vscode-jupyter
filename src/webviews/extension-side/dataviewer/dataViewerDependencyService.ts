// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IKernel } from '../../../kernels/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IsCodeSpace } from '../../../platform/common/types';
import { KernelDataViewerDependencyImplementation } from './kernelDataViewerDependencyImplementation';
import { IDataViewerDependencyService } from './types';

/**
 * Responsible for managing dependencies of a Data Viewer.
 */
@injectable()
export class DataViewerDependencyService implements IDataViewerDependencyService {
    private withKernel: IDataViewerDependencyService;
    constructor(
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(IsCodeSpace) isCodeSpace: boolean
    ) {
        this.withKernel = new KernelDataViewerDependencyImplementation(applicationShell, isCodeSpace);
    }

    async checkAndInstallMissingDependencies(kernel: IKernel): Promise<void> {
        return this.withKernel.checkAndInstallMissingDependencies(kernel);
    }
}
