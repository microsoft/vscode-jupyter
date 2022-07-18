// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IApplicationShell } from '../../../platform/common/application/types';
import { DataScience, Common } from '../../../platform/common/utils/localize';
import { IKernel } from '../../../kernels/types';
import { IDataViewerDependencyService } from './types';
import { pandasMinimumVersionSupportedByVariableViewer } from './constants';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';

/**
 * base class of the data viewer dependency implementation.
 */
export abstract class BaseDataViewerDependencyImplementation implements IDataViewerDependencyService {
    constructor(private readonly applicationShell: IApplicationShell, private isCodeSpace: boolean) {}

    abstract checkAndInstallMissingDependencies(executionEnvironment: IKernel | PythonEnvironment): Promise<void>;

    protected async promptInstall(): Promise<boolean> {
        let selection = this.isCodeSpace
            ? Common.install()
            : await this.applicationShell.showErrorMessage(
                  DataScience.pandasRequiredForViewing().format(pandasMinimumVersionSupportedByVariableViewer),
                  { modal: true },
                  Common.install()
              );

        return selection === Common.install();
    }
}
