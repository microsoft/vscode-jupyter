// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IWindowsStoreInterpreter } from '../interpreter/locators/types';
import { IServiceManager } from '../ioc/types';
import {
    EnvironmentActivationService,
    InterpreterSelector,
    InterpreterService,
    PythonApiProvider,
    PythonDebuggerPathProvider,
    PythonInstaller,
    WindowsStoreInterpreter
} from './pythonApi';
import { IPythonApiProvider, IPythonDebuggerPathProvider, IPythonInstaller } from './types';

export function registerTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonApiProvider>(IPythonApiProvider, PythonApiProvider);
    serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
    serviceManager.addSingleton<IInterpreterSelector>(IInterpreterSelector, InterpreterSelector);
    serviceManager.addSingleton<IWindowsStoreInterpreter>(IWindowsStoreInterpreter, WindowsStoreInterpreter);
    serviceManager.addSingleton<IPythonDebuggerPathProvider>(IPythonDebuggerPathProvider, PythonDebuggerPathProvider);
    serviceManager.addSingleton<IEnvironmentActivationService>(
        IEnvironmentActivationService,
        EnvironmentActivationService
    );
    serviceManager.addSingleton<IPythonInstaller>(IPythonInstaller, PythonInstaller);
}
