// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceManager } from '../../ioc/types';
import { CondaService } from './condaService.node';
import { ProcessServiceFactory } from './processFactory.node';
import { PythonExecutionFactory } from './pythonExecutionFactory.node';
import { IProcessServiceFactory, IPythonExecutionFactory } from './types.node';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IProcessServiceFactory>(IProcessServiceFactory, ProcessServiceFactory);
    serviceManager.addSingleton<IPythonExecutionFactory>(IPythonExecutionFactory, PythonExecutionFactory);
    serviceManager.addSingleton<CondaService>(CondaService, CondaService);
}
