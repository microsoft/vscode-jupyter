// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceManager } from '../platform/ioc/types';
import { IExtensionActivationManager, IExtensionSyncActivationService } from '../platform/activation/types';
import { CommandRegistry as ExportCommandRegistry } from './import-export/commandRegistry';
import { ActiveEditorContextService } from './context/activeEditorContext';
import { GlobalActivation } from './activation/globalActivation';
import { INotebookExporter } from '../kernels/jupyter/types';
import { JupyterExporter } from './import-export/jupyterExporter';
import { JupyterKernelServiceFactory } from './api/kernelApi';
import { IExportedKernelServiceFactory } from './api/api';
import { ApiAccessService } from './api/apiAccessService';
import { ExtensionActivationManager } from './activation/activationManager';
import { registerTypes as registerDevToolTypes } from './devTools/serviceRegistry';
import { IExtensionContext } from '../platform/common/types';
import { registerTypes as registerIntellisenseTypes } from './intellisense/serviceRegistry.web';
import { PythonExtensionRestartNotification } from './notification/pythonExtensionRestartNotification';
import { ImportTracker } from './import-export/importTracker';
import { UserJupyterServerUrlProvider } from './userJupyterServer/userServerUrlProvider';
import { JupyterServerSelectorForTests } from './userJupyterServer/serverSelectorForTests';
import { JupyterPasswordConnect } from './userJupyterServer/jupyterPasswordConnect';
import { IJupyterPasswordConnect } from './userJupyterServer/types';

export function registerTypes(context: IExtensionContext, serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, GlobalActivation);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ActiveEditorContextService
    );

    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ExportCommandRegistry
    );

    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, ImportTracker);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        JupyterServerSelectorForTests
    );

    // Activation Manager
    serviceManager.add<IExtensionActivationManager>(IExtensionActivationManager, ExtensionActivationManager);
    serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);

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
    registerIntellisenseTypes(serviceManager, isDevMode);

    // Dev Tools
    registerDevToolTypes(context, isDevMode);

    // User jupyter server url provider
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        UserJupyterServerUrlProvider
    );
    serviceManager.addSingleton<IJupyterPasswordConnect>(IJupyterPasswordConnect, JupyterPasswordConnect);
}
