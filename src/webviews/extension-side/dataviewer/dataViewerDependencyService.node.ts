// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IInstaller } from '../../../platform/interpreter/installer/types';
import { IKernel } from '../../../kernels/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IsCodeSpace } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IPythonExecutionFactory } from '../../../platform/interpreter/types.node';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { InterpreterDataViewerDependencyImplementation } from './interpreterDataViewerDependencyImplementation.node';
import { KernelDataViewerDependencyImplementation } from './kernelDataViewerDependencyImplementation';
import { IDataViewerDependencyService } from './types';

// TypeScript will narrow the type to PythonEnvironment in any block guarded by a call to isPythonEnvironment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPythonEnvironment(env: any): env is PythonEnvironment {
    return 'sysPrefix' in env && typeof env.sysPrefix === 'string';
}

/**
 * Responsible for managing dependencies of a Data Viewer.
 */
@injectable()
export class DataViewerDependencyService implements IDataViewerDependencyService {
    private withKernel: IDataViewerDependencyService;
    private withInterpreter: IDataViewerDependencyService;

    constructor(
        @inject(IInstaller) installer: IInstaller,
        @inject(IPythonExecutionFactory) pythonFactory: IPythonExecutionFactory,
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(IsCodeSpace) isCodeSpace: boolean
    ) {
        this.withKernel = new KernelDataViewerDependencyImplementation(applicationShell, isCodeSpace);
        this.withInterpreter = new InterpreterDataViewerDependencyImplementation(
            installer,
            pythonFactory,
            interpreterService,
            applicationShell,
            isCodeSpace
        );
    }

    async checkAndInstallMissingDependencies(executionEnvironment: IKernel | PythonEnvironment): Promise<void> {
        // IKernel and PythonEnvironment are only types, so I can't compare prototypes or instances of.
        if (isPythonEnvironment(executionEnvironment)) {
            return this.withInterpreter.checkAndInstallMissingDependencies(executionEnvironment);
        } else {
            return this.withKernel.checkAndInstallMissingDependencies(executionEnvironment);
        }
    }
}
