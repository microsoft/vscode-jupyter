// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { ApplicationEnvironment } from './common/application/applicationEnvironment.web';
import { ApplicationShell } from './common/application/applicationShell';
import { CommandManager } from './common/application/commandManager';
import {
    ICommandManager,
    IWorkspaceService,
    IApplicationShell,
    IApplicationEnvironment,
    IWebviewViewProvider,
    IWebviewPanelProvider
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
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from './activation/types';
import { OutputCommandListener } from './logging/outputCommandListener';

import { IFileSystem } from './common/platform/types';
import { FileSystem } from './common/platform/fileSystem';
import { KernelProgressReporter } from './progress/kernelProgressReporter';
import { WebviewPanelProvider } from './webviews/webviewPanelProvider';
import { WebviewViewProvider } from './webviews/webviewViewProvider';
import { InterpreterPackages } from './interpreter/interpreterPackages.web';
import { IInterpreterPackages } from './interpreter/types';
import { WorkspaceInterpreterTracker } from './interpreter/workspaceInterpreterTracker';
import { InterpreterCountTracker } from './interpreter/interpreterCountTracker';

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

    serviceManager.addSingleton<IInterpreterPackages>(IInterpreterPackages, InterpreterPackages);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        WorkspaceInterpreterTracker
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        InterpreterCountTracker
    );
    // Webview Provider
    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
    serviceManager.add<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);
}
