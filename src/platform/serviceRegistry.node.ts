// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceManager } from '../platform/ioc/types';
import { registerTypes as registerApiTypes } from './api/serviceRegistry.node';
import { registerTypes as registerCommonTypes } from './common/serviceRegistry.node';
import { registerTypes as registerTerminalTypes } from './terminals/serviceRegistry.node';
import { DataScienceStartupTime } from './common/constants';
import { IExtensionSyncActivationService } from './activation/types';
import { IConfigurationService, IDataScienceCommandListener } from './common/types';
import { KernelProgressReporter } from './progress/kernelProgressReporter';
import { ProgressReporter } from './progress/progressReporter';
import { ApplicationShell } from './common/application/applicationShell';
import { CommandManager } from './common/application/commandManager';
import {
    ICommandManager,
    IWorkspaceService,
    IApplicationShell,
    IWebviewViewProvider,
    IWebviewPanelProvider
} from './common/application/types';
import { ConfigurationService } from './common/configuration/service.node';
import { IFileSystem } from './common/platform/types';
import { IFileSystemNode } from './common/platform/types.node';
import { FileSystem } from './common/platform/fileSystem.node';
import { WorkspaceService } from './common/application/workspace.node';
import { OutputCommandListener } from './logging/outputCommandListener';
import { WebviewViewProvider } from './webviews/webviewViewProvider';
import { WebviewPanelProvider } from './webviews/webviewPanelProvider';
import { IInterpreterPackages, IReservedPythonNamedProvider } from './interpreter/types';
import { ReservedNamedProvider } from './interpreter/reservedNamedProvider.node';
import { InterpreterPackages } from './interpreter/interpreterPackages.node';
import { WorkspaceInterpreterTracker } from './interpreter/workspaceInterpreterTracker';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<FileSystem>(FileSystem, FileSystem);
    serviceManager.addBinding(FileSystem, IFileSystemNode);
    serviceManager.addBinding(FileSystem, IFileSystem);
    serviceManager.addSingleton<ICommandManager>(ICommandManager, CommandManager);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IApplicationShell>(IApplicationShell, ApplicationShell);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);

    registerApiTypes(serviceManager);
    registerCommonTypes(serviceManager);
    registerTerminalTypes(serviceManager);

    // Root platform types
    serviceManager.addSingletonInstance<number>(DataScienceStartupTime, Date.now());

    serviceManager.addSingleton<ProgressReporter>(ProgressReporter, ProgressReporter);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelProgressReporter
    );
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, OutputCommandListener);

    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
    serviceManager.add<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);
    serviceManager.addSingleton<IReservedPythonNamedProvider>(IReservedPythonNamedProvider, ReservedNamedProvider);
    serviceManager.addSingleton<IInterpreterPackages>(IInterpreterPackages, InterpreterPackages);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        WorkspaceInterpreterTracker
    );
}
