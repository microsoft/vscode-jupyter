// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { DataScienceErrorHandlerNode } from '../errors/kernelErrorHandler.node';
import { IDataScienceErrorHandler } from '../errors/types';
import { IKernelSessionFactory, IJupyterServerConnector } from '../types';
import { JupyterCommandFactory } from './interpreter/jupyterCommand.node';
import { JupyterInterpreterDependencyService } from './interpreter/jupyterInterpreterDependencyService.node';
import { JupyterInterpreterSelectionCommand } from './interpreter/jupyterInterpreterSelectionCommand.node';
import { JupyterInterpreterSelector } from './interpreter/jupyterInterpreterSelector.node';
import { JupyterInterpreterService } from './interpreter/jupyterInterpreterService.node';
import { MigrateJupyterInterpreterStateService } from './interpreter/jupyterInterpreterStateStore';
import { JupyterInterpreterStateStore } from './interpreter/jupyterInterpreterStateStore';
import { JupyterInterpreterSubCommandExecutionService } from './interpreter/jupyterInterpreterSubCommandExecutionService.node';
import { NbConvertExportToPythonService } from './interpreter/nbconvertExportToPythonService.node';
import { NbConvertInterpreterDependencyChecker } from './interpreter/nbconvertInterpreterDependencyChecker.node';
import { JupyterConnection } from './connection/jupyterConnection';
import { JupyterKernelService } from './session/jupyterKernelService.node';
import { JupyterRemoteCachedKernelValidator } from './connection/jupyterRemoteCachedKernelValidator';
import { JupyterServerHelper } from './launcher/jupyterServerHelper.node';
import { JupyterServerConnector } from './launcher/jupyterServerConnector.node';
import { JupyterServerProvider } from './launcher/jupyterServerProvider.node';
import { JupyterServerStarter } from './launcher/jupyterServerStarter.node';
import { JupyterServerUriStorage } from './connection/serverUriStorage';
import { LiveRemoteKernelConnectionUsageTracker } from './connection/liveRemoteKernelConnectionTracker';
// eslint-disable-next-line import/no-restricted-paths
import { CodespacesJupyterServerSelector } from '../../codespaces/codeSpacesServerSelector';
import { JupyterRequestCreator } from './session/jupyterRequestCreator.node';
import { RequestAgentCreator } from './session/requestAgentCreator.node';
import {
    INbConvertInterpreterDependencyChecker,
    INbConvertExportToPythonService,
    IJupyterServerProvider,
    IJupyterInterpreterDependencyManager,
    IJupyterServerUriStorage,
    IJupyterKernelService,
    INotebookStarter,
    IJupyterRequestCreator,
    IJupyterRequestAgentCreator,
    ILiveRemoteKernelConnectionUsageTracker,
    IJupyterRemoteCachedKernelValidator,
    IJupyterServerHelper,
    IJupyterServerProviderRegistry
} from './types';
import { IJupyterCommandFactory, IJupyterSubCommandExecutionService } from './types.node';
import { RemoteKernelFinderController } from './finder/remoteKernelFinderController';
import { KernelSessionFactory } from '../common/kernelSessionFactory';
import { JupyterKernelSessionFactory } from './session/jupyterKernelSessionFactory';
import { IRemoteKernelFinderController } from './finder/types';
// eslint-disable-next-line import/no-restricted-paths
import { JupyterServerProviderRegistry } from '../../codespaces';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.add<IJupyterCommandFactory>(IJupyterCommandFactory, JupyterCommandFactory);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        JupyterInterpreterSelectionCommand
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        MigrateJupyterInterpreterStateService
    );
    serviceManager.addSingleton<IJupyterServerHelper>(IJupyterServerHelper, JupyterServerHelper);
    serviceManager.addSingleton<JupyterInterpreterDependencyService>(
        JupyterInterpreterDependencyService,
        JupyterInterpreterDependencyService
    );
    serviceManager.addSingleton<INbConvertInterpreterDependencyChecker>(
        INbConvertInterpreterDependencyChecker,
        NbConvertInterpreterDependencyChecker
    );
    serviceManager.addSingleton<INbConvertExportToPythonService>(
        INbConvertExportToPythonService,
        NbConvertExportToPythonService
    );
    serviceManager.addSingleton<JupyterInterpreterSelector>(JupyterInterpreterSelector, JupyterInterpreterSelector);
    serviceManager.addSingleton<JupyterInterpreterService>(JupyterInterpreterService, JupyterInterpreterService);
    serviceManager.addSingleton<JupyterInterpreterStateStore>(
        JupyterInterpreterStateStore,
        JupyterInterpreterStateStore
    );
    serviceManager.addSingleton<CodespacesJupyterServerSelector>(
        CodespacesJupyterServerSelector,
        CodespacesJupyterServerSelector
    );
    serviceManager.addSingleton<IJupyterKernelService>(IJupyterKernelService, JupyterKernelService);
    serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, JupyterServerProvider);
    serviceManager.addSingleton<IJupyterInterpreterDependencyManager>(
        IJupyterInterpreterDependencyManager,
        JupyterInterpreterSubCommandExecutionService
    );
    serviceManager.addSingleton<IJupyterSubCommandExecutionService>(
        IJupyterSubCommandExecutionService,
        JupyterInterpreterSubCommandExecutionService
    );
    serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
    serviceManager.addSingleton<INotebookStarter>(INotebookStarter, JupyterServerStarter);
    serviceManager.addSingleton<IJupyterServerConnector>(IJupyterServerConnector, JupyterServerConnector);
    serviceManager.addSingleton<IKernelSessionFactory>(IKernelSessionFactory, KernelSessionFactory);
    serviceManager.addSingleton<JupyterKernelSessionFactory>(JupyterKernelSessionFactory, JupyterKernelSessionFactory);
    serviceManager.addSingleton<IJupyterRequestCreator>(IJupyterRequestCreator, JupyterRequestCreator);
    serviceManager.addSingleton<IJupyterRequestAgentCreator>(IJupyterRequestAgentCreator, RequestAgentCreator);
    serviceManager.addSingleton<JupyterConnection>(JupyterConnection, JupyterConnection);
    serviceManager.addSingleton<ILiveRemoteKernelConnectionUsageTracker>(
        ILiveRemoteKernelConnectionUsageTracker,
        LiveRemoteKernelConnectionUsageTracker
    );
    serviceManager.addBinding(ILiveRemoteKernelConnectionUsageTracker, IExtensionSyncActivationService);
    serviceManager.addSingleton<IJupyterRemoteCachedKernelValidator>(
        IJupyterRemoteCachedKernelValidator,
        JupyterRemoteCachedKernelValidator
    );
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandlerNode);
    serviceManager.addSingleton<IRemoteKernelFinderController>(
        IRemoteKernelFinderController,
        RemoteKernelFinderController
    );
    serviceManager.addBinding(IRemoteKernelFinderController, IExtensionSyncActivationService);
    serviceManager.addSingleton<IJupyterServerProviderRegistry>(
        IJupyterServerProviderRegistry,
        JupyterServerProviderRegistry
    );
}
