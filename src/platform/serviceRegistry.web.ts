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
import { IConfigurationService, IDataScienceCommandListener } from './common/types';
import { IServiceManager } from './ioc/types';
import { ProgressReporter } from './progress/progressReporter';
import { StatusProvider } from './progress/statusProvider';
import { IStatusProvider } from './progress/types';
import { WorkspaceService } from './common/application/workspace.web';
import { IExtensionSyncActivationService } from './activation/types';
import { OutputCommandListener } from './logging/outputCommandListener';

import { IFileSystem } from './common/platform/types';
import { FileSystem } from './common/platform/fileSystem';
import { KernelProgressReporter } from './progress/kernelProgressReporter';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IFileSystem>(IFileSystem, FileSystem);
    serviceManager.addSingleton<ICommandManager>(ICommandManager, CommandManager);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IApplicationShell>(IApplicationShell, ApplicationShell);
    serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);
    serviceManager.addSingleton<IStatusProvider>(IStatusProvider, StatusProvider);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, OutputCommandListener);
    serviceManager.addSingleton<ProgressReporter>(ProgressReporter, ProgressReporter);

    registerCommonTypes(serviceManager);
    registerApiTypes(serviceManager);

    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelProgressReporter
    );
}
