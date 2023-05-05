// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { DataScienceErrorHandlerWeb } from '../errors/kernelErrorHandler.web';
import { IDataScienceErrorHandler } from '../errors/types';
import { IKernelSessionFactory, IJupyterServerConnector } from '../types';
import { JupyterConnection } from './connection/jupyterConnection';
import { JupyterKernelService } from './session/jupyterKernelService.web';
import { JupyterRemoteCachedKernelValidator } from './connection/jupyterRemoteCachedKernelValidator';
import { JupyterUriProviderRegistration } from './connection/jupyterUriProviderRegistration';
import { JupyterCommandLineSelector } from './launcher/commandLineSelector';
import { JupyterPasswordConnect } from './connection/jupyterPasswordConnect';
import { HostJupyterExecution } from './launcher/hostJupyterExecution';
import { JupyterServerConnector } from './launcher/jupyterServerConnector';
import { NotebookServerProvider } from './launcher/notebookServerProvider';
import { JupyterServerUriStorage } from './connection/serverUriStorage';
import { LiveRemoteKernelConnectionUsageTracker } from './connection/liveRemoteKernelConnectionTracker';
import { JupyterServerSelector } from './connection/serverSelector';
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
    IJupyterServerProvider,
    IJupyterExecution,
    IJupyterRequestCreator,
    ILiveRemoteKernelConnectionUsageTracker,
    IJupyterRemoteCachedKernelValidator
} from './types';
import { RemoteKernelFinderController } from './finder/remoteKernelFinderController';
import { KernelSessionFactory } from '../common/kernelSessionFactory';
import { JupyterKernelSessionFactory } from './session/jupyterKernelSessionFactory';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, HostJupyterExecution);
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
    serviceManager.addSingleton<IJupyterServerConnector>(IJupyterServerConnector, JupyterServerConnector);
    serviceManager.addSingleton<IKernelSessionFactory>(IKernelSessionFactory, KernelSessionFactory);
    serviceManager.addSingleton<JupyterKernelSessionFactory>(JupyterKernelSessionFactory, JupyterKernelSessionFactory);
    serviceManager.addSingleton<IJupyterBackingFileCreator>(IJupyterBackingFileCreator, BackingFileCreator);
    serviceManager.addSingleton<JupyterCommandLineSelector>(JupyterCommandLineSelector, JupyterCommandLineSelector);
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
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteKernelFinderController
    );
}
