// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { DataScienceErrorHandlerNode } from '../errors/kernelErrorHandler.node';
import { IDataScienceErrorHandler } from '../errors/types';
import { INotebookProvider } from '../types';
import { JupyterCommandFactory } from './interpreter/jupyterCommand.node';
import { JupyterInterpreterDependencyService } from './interpreter/jupyterInterpreterDependencyService.node';
import { JupyterInterpreterOldCacheStateStore } from './interpreter/jupyterInterpreterOldCacheStateStore.node';
import { JupyterInterpreterSelectionCommand } from './interpreter/jupyterInterpreterSelectionCommand.node';
import { JupyterInterpreterSelector } from './interpreter/jupyterInterpreterSelector.node';
import { JupyterInterpreterService } from './interpreter/jupyterInterpreterService.node';
import {
    MigrateJupyterInterpreterStateService,
    JupyterInterpreterStateStore
} from './interpreter/jupyterInterpreterStateStore.node';
import { JupyterInterpreterSubCommandExecutionService } from './interpreter/jupyterInterpreterSubCommandExecutionService.node';
import { NbConvertExportToPythonService } from './interpreter/nbconvertExportToPythonService.node';
import { NbConvertInterpreterDependencyChecker } from './interpreter/nbconvertInterpreterDependencyChecker.node';
import { JupyterConnection } from './connection/jupyterConnection';
import { JupyterDetectionTelemetry } from './jupyterDetectionTelemetry.node';
import { JupyterKernelService } from './session/jupyterKernelService.node';
import { JupyterRemoteCachedKernelValidator } from './connection/jupyterRemoteCachedKernelValidator';
import { JupyterUriProviderRegistration } from './connection/jupyterUriProviderRegistration';
import { JupyterCommandLineSelector } from './launcher/commandLineSelector';
import { JupyterNotebookProvider } from './launcher/jupyterNotebookProvider';
import { JupyterPasswordConnect } from './connection/jupyterPasswordConnect';
import { HostJupyterExecution } from './launcher/liveshare/hostJupyterExecution';
import { HostJupyterServerFactory } from './launcher/liveshare/hostJupyterServerFactory';
import { NotebookProvider } from './launcher/notebookProvider';
import { NotebookServerProvider } from './launcher/notebookServerProvider';
import { NotebookStarter } from './launcher/notebookStarter.node';
import { JupyterServerUriStorage } from './connection/serverUriStorage';
import { LiveRemoteKernelConnectionUsageTracker } from './connection/liveRemoteKernelConnectionTracker';
import { JupyterServerSelector } from './connection/serverSelector';
import { BackingFileCreator } from './session/backingFileCreator.node';
import { JupyterRequestCreator } from './session/jupyterRequestCreator.node';
import { JupyterSessionManagerFactory } from './session/jupyterSessionManagerFactory';
import { RequestAgentCreator } from './session/requestAgentCreator.node';
import {
    IJupyterNotebookProvider,
    IJupyterExecution,
    IJupyterPasswordConnect,
    IJupyterSessionManagerFactory,
    INbConvertInterpreterDependencyChecker,
    INbConvertExportToPythonService,
    IJupyterServerProvider,
    IJupyterInterpreterDependencyManager,
    IJupyterUriProviderRegistration,
    IJupyterServerUriStorage,
    IJupyterBackingFileCreator,
    IJupyterKernelService,
    INotebookStarter,
    IJupyterRequestCreator,
    IJupyterRequestAgentCreator,
    INotebookServerFactory,
    ILiveRemoteKernelConnectionUsageTracker,
    IJupyterRemoteCachedKernelValidator
} from './types';
import { IJupyterCommandFactory, IJupyterSubCommandExecutionService } from './types.node';
import { RemoteKernelFinderController } from './finder/remoteKernelFinderController';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.add<IJupyterCommandFactory>(IJupyterCommandFactory, JupyterCommandFactory);
    serviceManager.add<INotebookServerFactory>(INotebookServerFactory, HostJupyterServerFactory);
    serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        JupyterInterpreterSelectionCommand
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        MigrateJupyterInterpreterStateService
    );
    serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, HostJupyterExecution);
    serviceManager.addSingleton<IJupyterPasswordConnect>(IJupyterPasswordConnect, JupyterPasswordConnect);
    serviceManager.addSingleton<IJupyterSessionManagerFactory>(
        IJupyterSessionManagerFactory,
        JupyterSessionManagerFactory
    );
    serviceManager.addSingleton<JupyterCommandLineSelector>(JupyterCommandLineSelector, JupyterCommandLineSelector);
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
    serviceManager.addSingleton<JupyterInterpreterOldCacheStateStore>(
        JupyterInterpreterOldCacheStateStore,
        JupyterInterpreterOldCacheStateStore
    );
    serviceManager.addSingleton<JupyterInterpreterSelector>(JupyterInterpreterSelector, JupyterInterpreterSelector);
    serviceManager.addSingleton<JupyterInterpreterService>(JupyterInterpreterService, JupyterInterpreterService);
    serviceManager.addSingleton<JupyterInterpreterStateStore>(
        JupyterInterpreterStateStore,
        JupyterInterpreterStateStore
    );
    serviceManager.addSingleton<JupyterServerSelector>(JupyterServerSelector, JupyterServerSelector);
    serviceManager.addSingleton<IJupyterKernelService>(IJupyterKernelService, JupyterKernelService);
    serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, NotebookServerProvider);
    serviceManager.addSingleton<IJupyterInterpreterDependencyManager>(
        IJupyterInterpreterDependencyManager,
        JupyterInterpreterSubCommandExecutionService
    );
    serviceManager.addSingleton<IJupyterSubCommandExecutionService>(
        IJupyterSubCommandExecutionService,
        JupyterInterpreterSubCommandExecutionService
    );
    serviceManager.addSingleton<IJupyterUriProviderRegistration>(
        IJupyterUriProviderRegistration,
        JupyterUriProviderRegistration
    );
    serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
    serviceManager.addSingleton<INotebookStarter>(INotebookStarter, NotebookStarter);
    serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
    serviceManager.addSingleton<IJupyterBackingFileCreator>(IJupyterBackingFileCreator, BackingFileCreator);
    serviceManager.addSingleton<IJupyterRequestCreator>(IJupyterRequestCreator, JupyterRequestCreator);
    serviceManager.addSingleton<IJupyterRequestAgentCreator>(IJupyterRequestAgentCreator, RequestAgentCreator);
    serviceManager.addSingleton<JupyterConnection>(JupyterConnection, JupyterConnection);
    serviceManager.addBinding(JupyterConnection, IExtensionSyncActivationService);
    serviceManager.addSingleton<ILiveRemoteKernelConnectionUsageTracker>(
        ILiveRemoteKernelConnectionUsageTracker,
        LiveRemoteKernelConnectionUsageTracker
    );
    serviceManager.addBinding(ILiveRemoteKernelConnectionUsageTracker, IExtensionSyncActivationService);
    serviceManager.addSingleton<IJupyterRemoteCachedKernelValidator>(
        IJupyterRemoteCachedKernelValidator,
        JupyterRemoteCachedKernelValidator
    );
    serviceManager.addSingleton<JupyterDetectionTelemetry>(IExtensionSyncActivationService, JupyterDetectionTelemetry);
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandlerNode);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteKernelFinderController
    );
}
