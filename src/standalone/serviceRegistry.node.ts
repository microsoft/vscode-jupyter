// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionActivationManager, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { INotebookExporter, INotebookImporter } from '../kernels/jupyter/types';
import { JupyterExporter } from './import-export/jupyterExporter';
import { JupyterImporter } from './import-export/jupyterImporter.node';
import { CommandRegistry as ExportCommandRegistry } from './import-export/commandRegistry';
import { ExtensionRecommendationService } from './recommendation/extensionRecommendation.node';
import { ActiveEditorContextService } from './context/activeEditorContext';
import { IImportTracker, ImportTracker } from './import-export/importTracker';
import { GlobalActivation } from './activation/globalActivation';
import { JupyterKernelServiceFactory } from './api/unstable/kernelApi';
import { ApiAccessService } from './api/unstable/apiAccessService';
import { WorkspaceActivation } from './activation/workspaceActivation.node';
import { ExtensionActivationManager } from './activation/activationManager';
import { DataScienceSurveyBanner, ISurveyBanner } from './survey/dataScienceSurveyBanner.node';
import { IExtensionContext } from '../platform/common/types';
import { registerTypes as registerDevToolTypes } from './devTools/serviceRegistry';
import { registerTypes as registerIntellisenseTypes } from './intellisense/serviceRegistry.node';
import { PythonExtensionRestartNotification } from './notification/pythonExtensionRestartNotification';
import { UserJupyterServerUrlProvider } from './userJupyterServer/userServerUrlProvider';
import { JupyterServerSelectorCommand } from './userJupyterServer/serverSelectorForTests';
import { CommandRegistry as CodespaceCommandRegistry } from './codespace/commandRegistry';
import { EagerlyActivateJupyterUriProviders } from './api/unstable/activateJupyterProviderExtensions';
import { ExposeUsedAzMLServerHandles } from './api/unstable/usedAzMLServerHandles.deprecated';
import { IExportedKernelServiceFactory } from './api/unstable/types';
import { KernelApi } from './api/kernels/accessManagement';

export function registerTypes(context: IExtensionContext, serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, GlobalActivation);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, WorkspaceActivation);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ExtensionRecommendationService
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ActiveEditorContextService
    );
    serviceManager.addSingleton<IImportTracker>(IImportTracker, ImportTracker);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, ImportTracker);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        EagerlyActivateJupyterUriProviders
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        JupyterServerSelectorCommand
    );

    // Import/Export
    serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);
    serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ExportCommandRegistry
    );

    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        CodespaceCommandRegistry
    );

    serviceManager.addSingleton<ISurveyBanner>(ISurveyBanner, DataScienceSurveyBanner);
    serviceManager.addBinding(ISurveyBanner, IExtensionSyncActivationService);
    // Activation Manager
    serviceManager.add<IExtensionActivationManager>(IExtensionActivationManager, ExtensionActivationManager);

    // API
    serviceManager.addSingleton<IExportedKernelServiceFactory>(
        IExportedKernelServiceFactory,
        JupyterKernelServiceFactory
    );
    serviceManager.addSingleton<ApiAccessService>(ApiAccessService, ApiAccessService);

    // Notification
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        PythonExtensionRestartNotification
    );

    // Intellisense
    registerIntellisenseTypes(serviceManager);

    // Dev Tools
    registerDevToolTypes(context, isDevMode);

    // User jupyter server url provider
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        UserJupyterServerUrlProvider
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ExposeUsedAzMLServerHandles
    );

    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelApi);
}
