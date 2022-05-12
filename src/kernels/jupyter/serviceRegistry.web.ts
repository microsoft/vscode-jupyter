// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { IRemoteKernelFinder } from '../raw/types';
import { INotebookProvider } from '../types';
import { JupyterCommandLineSelectorCommand } from './commands/commandLineSelector';
import { CommandRegistry } from './commands/commandRegistry';
import { JupyterServerSelectorCommand } from './commands/serverSelector';
import { JupyterConnection } from './jupyterConnection';
import { JupyterKernelService } from './jupyterKernelService.web';
import { JupyterUriProviderRegistration } from './jupyterUriProviderRegistration';
import { JupyterCommandLineSelector } from './launcher/commandLineSelector';
import { JupyterNotebookProvider } from './launcher/jupyterNotebookProvider';
import { JupyterPasswordConnect } from './launcher/jupyterPasswordConnect';
import { HostJupyterExecution } from './launcher/liveshare/hostJupyterExecution';
import { HostJupyterServerFactory } from './launcher/liveshare/hostJupyterServerFactory';
import { NotebookProvider } from './launcher/notebookProvider';
import { NotebookServerProvider } from './launcher/notebookServerProvider';
import { ServerConnectionType } from './launcher/serverConnectionType';
import { JupyterServerUriStorage } from './launcher/serverUriStorage';
import { LiveRemoteKernelConnectionUsageTracker } from './liveRemoteKernelConnectionTracker';
import { RemoteKernelConnectionHandler } from './remoteKernelConnectionHandler';
import { RemoteKernelFinder } from './remoteKernelFinder';
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
    ILiveRemoteKernelConnectionUsageTracker
} from './types';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);
    serviceManager.addSingleton<IRemoteKernelFinder>(IRemoteKernelFinder, RemoteKernelFinder);
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
    serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
    serviceManager.addSingleton<IJupyterBackingFileCreator>(IJupyterBackingFileCreator, BackingFileCreator);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CommandRegistry);
    serviceManager.addSingleton<JupyterCommandLineSelector>(JupyterCommandLineSelector, JupyterCommandLineSelector);
    serviceManager.addSingleton<JupyterCommandLineSelectorCommand>(
        JupyterCommandLineSelectorCommand,
        JupyterCommandLineSelectorCommand
    );
    serviceManager.addSingleton<JupyterServerSelectorCommand>(
        JupyterServerSelectorCommand,
        JupyterServerSelectorCommand
    );
    serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, NotebookServerProvider);
    serviceManager.addSingleton<IJupyterRequestCreator>(IJupyterRequestCreator, JupyterRequestCreator);
    serviceManager.addSingleton<ServerConnectionType>(ServerConnectionType, ServerConnectionType);
    serviceManager.addSingleton<JupyterConnection>(JupyterConnection, JupyterConnection);
    serviceManager.addBinding(JupyterConnection, IExtensionSyncActivationService);
    serviceManager.addSingleton<ILiveRemoteKernelConnectionUsageTracker>(
        ILiveRemoteKernelConnectionUsageTracker,
        LiveRemoteKernelConnectionUsageTracker
    );
    serviceManager.addBinding(ILiveRemoteKernelConnectionUsageTracker, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteKernelConnectionHandler
    );
}
