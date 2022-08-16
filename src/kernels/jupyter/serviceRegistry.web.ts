// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { DataScienceErrorHandlerWeb } from '../errors/kernelErrorHandler.web';
import { IDataScienceErrorHandler } from '../errors/types';
import { INotebookProvider } from '../types';
import { JupyterCommandLineSelectorCommand } from './commands/commandLineSelector';
import { CommandRegistry } from './commands/commandRegistry';
import { JupyterConnection } from './jupyterConnection';
import { JupyterKernelService } from './jupyterKernelService.web';
import { JupyterRemoteCachedKernelValidator } from './jupyterRemoteCachedKernelValidator';
import { JupyterUriProviderRegistration } from './jupyterUriProviderRegistration';
import { JupyterCommandLineSelector } from './launcher/commandLineSelector';
import { JupyterNotebookProvider } from './launcher/jupyterNotebookProvider';
import { JupyterPasswordConnect } from './launcher/jupyterPasswordConnect';
import { HostJupyterExecution } from './launcher/liveshare/hostJupyterExecution';
import { HostJupyterServerFactory } from './launcher/liveshare/hostJupyterServerFactory';
import { NotebookProvider } from './launcher/notebookProvider';
import { NotebookServerProvider } from './launcher/notebookServerProvider';
import { JupyterServerUriStorage } from './launcher/serverUriStorage';
import { LiveRemoteKernelConnectionUsageTracker } from './liveRemoteKernelConnectionTracker';
import { RemoteKernelFinder } from './finder/remoteKernelFinder';
import { JupyterServerSelector } from './serverSelector';
import { BackingFileCreator } from './session/backingFileCreator.web';
import { JupyterRequestCreator } from './session/jupyterRequestCreator.web';
import { JupyterSessionManagerFactory } from './session/jupyterSessionManagerFactory';
import {
    IJupyterPasswordConnect,
    IJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration,
    IJupyterServerUriStorage,
    IJupyterBackingFileCreator,
    IJupyterKernelService,
    IJupyterNotebookProvider,
    IJupyterServerProvider,
    IJupyterExecution,
    IJupyterRequestCreator,
    INotebookServerFactory,
    ILiveRemoteKernelConnectionUsageTracker,
    IJupyterRemoteCachedKernelValidator,
    IServerConnectionType
} from './types';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);

    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        RemoteKernelFinder
    );
    serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, HostJupyterExecution);
    serviceManager.add<INotebookServerFactory>(INotebookServerFactory, HostJupyterServerFactory);
    serviceManager.addSingleton<IJupyterPasswordConnect>(IJupyterPasswordConnect, JupyterPasswordConnect);
    serviceManager.addSingleton<IJupyterSessionManagerFactory>(
        IJupyterSessionManagerFactory,
        JupyterSessionManagerFactory
    );
    serviceManager.addSingleton<JupyterServerSelector>(JupyterServerSelector, JupyterServerSelector);
    serviceManager.addSingleton<IJupyterKernelService>(IJupyterKernelService, JupyterKernelService);
    serviceManager.addSingleton<IJupyterUriProviderRegistration>(
        IJupyterUriProviderRegistration,
        JupyterUriProviderRegistration
    );
    serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
    serviceManager.addBinding(IJupyterServerUriStorage, IServerConnectionType);
    serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
    serviceManager.addSingleton<IJupyterBackingFileCreator>(IJupyterBackingFileCreator, BackingFileCreator);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CommandRegistry);
    serviceManager.addSingleton<JupyterCommandLineSelector>(JupyterCommandLineSelector, JupyterCommandLineSelector);
    serviceManager.addSingleton<JupyterCommandLineSelectorCommand>(
        JupyterCommandLineSelectorCommand,
        JupyterCommandLineSelectorCommand
    );
    serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, NotebookServerProvider);
    serviceManager.addSingleton<IJupyterRequestCreator>(IJupyterRequestCreator, JupyterRequestCreator);
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
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandlerWeb);
}
