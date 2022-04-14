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
import { WorkspaceService } from './common/application/workspace';
import { ConfigurationService } from './common/configuration/service.web';
import { registerTypes as registerApiTypes } from './api/serviceRegistry.web';
import { registerTypes as registerCommonTypes } from './common/serviceRegistry.web';
import { registerTypes as registerActivationTypes } from './activation/serviceRegistry.web';
import { registerTypes as registerDevToolTypes } from './devTools/serviceRegistry';
import { IConfigurationService, IExtensionContext } from './common/types';
import { IServiceManager } from './ioc/types';

export function registerTypes(context: IExtensionContext, serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<ICommandManager>(ICommandManager, CommandManager);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IApplicationShell>(IApplicationShell, ApplicationShell);
    serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);

    registerCommonTypes(serviceManager);
    registerApiTypes(serviceManager);
    registerActivationTypes(serviceManager);
    registerDevToolTypes(context, serviceManager, isDevMode);
}
