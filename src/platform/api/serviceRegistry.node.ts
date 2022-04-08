// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService } from '../activation/types';
import { EnvironmentActivationService } from '../common/process/environmentActivationService.node';
import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts.node';
import { InterpreterStatusBarVisibility } from '../interpreter/display/visibilityFilter.node';
import { IServiceManager } from '../ioc/types';
import { ApiAccessService } from './apiAccessService.node';
import { JupyterKernelServiceFactory } from './kernelApi.node';
import {
    InterpreterSelector,
    InterpreterService,
    LanguageServerProvider,
    PythonApiProvider,
    PythonDebuggerPathProvider,
    PythonExtensionChecker
} from './pythonApi.node';
import {
    IExportedKernelServiceFactory,
    ILanguageServerProvider,
    IPythonApiProvider,
    IPythonDebuggerPathProvider,
    IPythonExtensionChecker
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
    serviceManager.addSingleton<IExportedKernelServiceFactory>(
        IExportedKernelServiceFactory,
        JupyterKernelServiceFactory
    );
    serviceManager.addSingleton<ApiAccessService>(ApiAccessService, ApiAccessService);
}
