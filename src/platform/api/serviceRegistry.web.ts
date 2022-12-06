// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceManager } from '../ioc/types';
import { InterpreterSelector, InterpreterService, PythonApiProvider, PythonExtensionChecker } from './pythonApi';
import { IPythonApiProvider, IPythonExtensionChecker } from './types';

export function registerTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonApiProvider>(IPythonApiProvider, PythonApiProvider);
    serviceManager.addSingleton<IPythonExtensionChecker>(IPythonExtensionChecker, PythonExtensionChecker);
    serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
    serviceManager.addSingleton<IInterpreterSelector>(IInterpreterSelector, InterpreterSelector);
}
