// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { IKernel } from '../../../kernels/types';
import { KernelDataViewerDependencyImplementation } from './kernelDataViewerDependencyImplementation';
import { IDataViewerDependencyService } from './types';

/**
 * Responsible for managing dependencies of a Data Viewer.
 */
@injectable()
export class DataViewerDependencyService implements IDataViewerDependencyService {
    private withKernel: IDataViewerDependencyService;
    constructor() {
        this.withKernel = new KernelDataViewerDependencyImplementation();
    }

    async checkAndInstallMissingDependencies(kernel: IKernel): Promise<void> {
        return this.withKernel.checkAndInstallMissingDependencies(kernel);
    }
}
