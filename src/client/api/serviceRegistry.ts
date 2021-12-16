// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService } from '../activation/types';
import { EnvironmentActivationService } from '../common/process/interpreterActivation';
import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { InterpreterStatusBarVisibility } from '../interpreter/display/visibilityFilter';
import { IServiceManager } from '../ioc/types';
import { JupyterKernelServiceFactory } from './kernelApi';
import {
    InterpreterSelector,
    InterpreterService,
    LanguageServerProvider,
    PythonApiProvider,
    PythonDebuggerPathProvider,
    PythonExtensionChecker,
    PythonInstaller
} from './pythonApi';
import {
    ILanguageServerProvider,
    IPythonApiProvider,
    IPythonDebuggerPathProvider,
    IPythonExtensionChecker,
    IPythonInstaller
} from './types';

export function registerTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonApiProvider>(IPythonApiProvider, PythonApiProvider);
    serviceManager.addSingleton<IPythonExtensionChecker>(IPythonExtensionChecker, PythonExtensionChecker);
    serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
    serviceManager.addSingleton<IInterpreterSelector>(IInterpreterSelector, InterpreterSelector);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        InterpreterStatusBarVisibility
    );
    serviceManager.addSingleton<IPythonDebuggerPathProvider>(IPythonDebuggerPathProvider, PythonDebuggerPathProvider);
    serviceManager.addSingleton<ILanguageServerProvider>(ILanguageServerProvider, LanguageServerProvider);
    serviceManager.addSingleton<IEnvironmentActivationService>(
        IEnvironmentActivationService,
        EnvironmentActivationService
    );
    serviceManager.addSingleton<IPythonInstaller>(IPythonInstaller, PythonInstaller);
    serviceManager.addSingleton<JupyterKernelServiceFactory>(JupyterKernelServiceFactory, JupyterKernelServiceFactory);
}
