// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ApplicationEnvironment } from './common/application/applicationEnvironment.web';
import {
    IWorkspaceService,
    IApplicationEnvironment,
    IWebviewViewProvider,
    IWebviewPanelProvider
} from './common/application/types';
import { ConfigurationService } from './common/configuration/service.web';
import { registerTypes as registerApiTypes } from './api/serviceRegistry.web';
import { registerTypes as registerCommonTypes } from './common/serviceRegistry.web';
import { IConfigurationService, IDataScienceCommandListener } from './common/types';
import { registerTypes as registerInterpreterTypes } from './interpreter/serviceRegistry.web';
import { IServiceManager } from './ioc/types';
import { ProgressReporter } from './progress/progressReporter';
import { WorkspaceService } from './common/application/workspace.web';
import { IExtensionSyncActivationService } from './activation/types';
import { OutputCommandListener } from './logging/outputCommandListener';

import { IFileSystem } from './common/platform/types';
import { FileSystem } from './common/platform/fileSystem';
import { KernelProgressReporter } from './progress/kernelProgressReporter';
import { WebviewPanelProvider } from './webviews/webviewPanelProvider';
import { WebviewViewProvider } from './webviews/webviewViewProvider';
import { WorkspaceInterpreterTracker } from './interpreter/workspaceInterpreterTracker';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IFileSystem>(IFileSystem, FileSystem);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, OutputCommandListener);
    serviceManager.addSingleton<ProgressReporter>(ProgressReporter, ProgressReporter);

    registerCommonTypes(serviceManager);
    registerApiTypes(serviceManager);
    registerInterpreterTypes(serviceManager);

    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelProgressReporter
    );

    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        WorkspaceInterpreterTracker
    );
    // Webview Provider
    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
    serviceManager.add<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);
}
