// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { DataScienceErrorHandlerWeb } from '../errors/kernelErrorHandler.web';
import { IDataScienceErrorHandler } from '../errors/types';
import { IKernelSessionFactory } from '../types';
import { JupyterConnection } from './connection/jupyterConnection';
import { JupyterKernelService } from './session/jupyterKernelService.web';
import { JupyterRemoteCachedKernelValidator } from './connection/jupyterRemoteCachedKernelValidator';
import { JupyterServerProvider } from './launcher/jupyterServerProvider.web';
import { JupyterServerUriStorage } from './connection/serverUriStorage';
import { LiveRemoteKernelConnectionUsageTracker } from './connection/liveRemoteKernelConnectionTracker';
import { JupyterRequestCreator } from './session/jupyterRequestCreator.web';
import {
    IJupyterServerUriStorage,
    IJupyterKernelService,
    IJupyterServerProvider,
    IJupyterRequestCreator,
    ILiveRemoteKernelConnectionUsageTracker,
    IJupyterRemoteCachedKernelValidator,
    IJupyterServerProviderRegistry
} from './types';
import { RemoteKernelFinderController } from './finder/remoteKernelFinderController';
import { KernelSessionFactory } from '../common/kernelSessionFactory';
import { JupyterKernelSessionFactory } from './session/jupyterKernelSessionFactory';
import { IRemoteKernelFinderController } from './finder/types';
// eslint-disable-next-line import/no-restricted-paths
import { JupyterServerProviderRegistry } from '../../codespaces';
// eslint-disable-next-line import/no-restricted-paths
import { CodespacesJupyterServerSelector } from '../../codespaces/codeSpacesServerSelector';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<CodespacesJupyterServerSelector>(
        CodespacesJupyterServerSelector,
        CodespacesJupyterServerSelector
    );
    serviceManager.addSingleton<IJupyterKernelService>(IJupyterKernelService, JupyterKernelService);
    serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
    serviceManager.addSingleton<IKernelSessionFactory>(IKernelSessionFactory, KernelSessionFactory);
    serviceManager.addSingleton<JupyterKernelSessionFactory>(JupyterKernelSessionFactory, JupyterKernelSessionFactory);
    serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, JupyterServerProvider);
    serviceManager.addSingleton<IJupyterRequestCreator>(IJupyterRequestCreator, JupyterRequestCreator);
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
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandlerWeb);
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
