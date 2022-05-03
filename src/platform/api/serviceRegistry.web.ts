// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceManager } from '../ioc/types';
import { ApiAccessService } from './apiAccessService';
import { JupyterKernelServiceFactory } from './kernelApi';
import { InterpreterSelector, InterpreterService, PythonApiProvider, PythonExtensionChecker } from './pythonApi';
import { IExportedKernelServiceFactory, IPythonApiProvider, IPythonExtensionChecker } from './types';

export function registerTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonApiProvider>(IPythonApiProvider, PythonApiProvider);
    serviceManager.addSingleton<IPythonExtensionChecker>(IPythonExtensionChecker, PythonExtensionChecker);
    serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
    serviceManager.addSingleton<IInterpreterSelector>(IInterpreterSelector, InterpreterSelector);
    serviceManager.addSingleton<ApiAccessService>(ApiAccessService, ApiAccessService);
    serviceManager.addSingleton<IExportedKernelServiceFactory>(
        IExportedKernelServiceFactory,
        JupyterKernelServiceFactory
    );
}
