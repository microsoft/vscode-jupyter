// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { ApplicationEnvironment } from './common/application/applicationEnvironment.web';
import { ApplicationShell } from './common/application/applicationShell';
import { CommandManager } from './common/application/commandManager';
import {
    ICommandManager,
    IWorkspaceService,
    IApplicationShell,
    IApplicationEnvironment
} from './common/application/types';
import { ConfigurationService } from './common/configuration/service.web';
import { registerTypes as registerApiTypes } from './api/serviceRegistry.web';
import { registerTypes as registerCommonTypes } from './common/serviceRegistry.web';
import { registerTypes as registerActivationTypes } from './activation/serviceRegistry.web';
import { registerTypes as registerDevToolTypes } from './devTools/serviceRegistry';
import { IConfigurationService, IExtensionContext } from './common/types';
import { IServiceManager } from './ioc/types';
import { StatusProvider } from './progress/statusProvider';
import { IStatusProvider } from './progress/types';
import { WorkspaceService } from './common/application/workspace.web';
import { DataScienceErrorHandler } from './errors/errorHandler';
import { IDataScienceErrorHandler } from './errors/types';
import { GlobalActivation } from './common/globalActivation.web';
import { IExtensionSingleActivationService } from './activation/types';

export function registerTypes(context: IExtensionContext, serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<ICommandManager>(ICommandManager, CommandManager);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IApplicationShell>(IApplicationShell, ApplicationShell);
    serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);
    serviceManager.addSingleton<IStatusProvider>(IStatusProvider, StatusProvider);
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, GlobalActivation);

    registerCommonTypes(serviceManager);
    registerApiTypes(serviceManager);
    registerActivationTypes(serviceManager);
    registerDevToolTypes(context, serviceManager, isDevMode);
}
