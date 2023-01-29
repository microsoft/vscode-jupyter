// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../activation/types';
import { EnvironmentActivationService } from '../common/process/environmentActivationService.node';
import { IEnvironmentActivationService } from '../interpreter/activation/types';
import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { InterpreterStatusBarVisibility } from '../interpreter/display/visibilityFilter.node';
import { IServiceManager } from '../ioc/types';
import { InterpreterSelector, InterpreterService, PythonApiProvider, PythonExtensionChecker } from './pythonApi';
import { IPythonApiProvider, IPythonExtensionChecker } from './types';

export function registerTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonApiProvider>(IPythonApiProvider, PythonApiProvider);
    serviceManager.addSingleton<IPythonExtensionChecker>(IPythonExtensionChecker, PythonExtensionChecker);
    serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
    serviceManager.addSingleton<IInterpreterSelector>(IInterpreterSelector, InterpreterSelector);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        InterpreterStatusBarVisibility
    );
    serviceManager.addSingleton<IEnvironmentActivationService>(
        IEnvironmentActivationService,
        EnvironmentActivationService
    );
}
