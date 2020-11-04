// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IExtensionSingleActivationService } from '../activation/types';
import { IServiceManager } from '../ioc/types';
import { CommandRegistry } from './commands';
import { JupyterServerAuthService } from './connection/jupyterServerAuthService';
import { JupyterRemoteServiceHelper } from './connection/remoteService';
import { RemoteKernelPickerProvider } from './kernels/kernelProvider';
import { RemoteFileSystemFactory } from './ui/fileSystem';
import { JupyterServersTreeDataProvider } from './ui/serversTreeDataProvider';
import { JupyterServersTreeView } from './ui/serversTreeView';
import { IJupyterServerAuthServiceProvider } from './ui/types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<JupyterServersTreeDataProvider>(
        JupyterServersTreeDataProvider,
        JupyterServersTreeDataProvider
    );
    serviceManager.addSingleton<IJupyterServerAuthServiceProvider>(
        IJupyterServerAuthServiceProvider,
        JupyterServerAuthService
    );
    serviceManager.addSingleton<RemoteKernelPickerProvider>(RemoteKernelPickerProvider, RemoteKernelPickerProvider);
    serviceManager.addSingleton<JupyterRemoteServiceHelper>(JupyterRemoteServiceHelper, JupyterRemoteServiceHelper);
    serviceManager.addBinding(JupyterRemoteServiceHelper, IExtensionSingleActivationService);
    serviceManager.addSingleton<RemoteFileSystemFactory>(RemoteFileSystemFactory, RemoteFileSystemFactory);
    serviceManager.addBinding(RemoteFileSystemFactory, IExtensionSingleActivationService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        JupyterServersTreeView
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CommandRegistry);
}
