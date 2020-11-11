// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IExtensionSingleActivationService } from '../activation/types';
import { IServiceManager } from '../ioc/types';
import { CommandRegistry } from './commands';
import { RemoteFileSchemeManager } from './connection/fileSchemeManager';
import { JupyterServerConnectionService } from './connection/remoteConnectionsService';
import { RemoteFileSystemFactory } from './ui/fileSystemFactory';
import { NotebookCreator } from './ui/notebookCreator';
import { JupyterServersTreeDataProvider } from './ui/serversTreeDataProvider';
import { JupyterServersTreeView } from './ui/serversTreeView';
import { IJupyterServerConnectionService } from './ui/types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<JupyterServersTreeDataProvider>(
        JupyterServersTreeDataProvider,
        JupyterServersTreeDataProvider
    );
    serviceManager.addSingleton<JupyterServerConnectionService>(
        IJupyterServerConnectionService,
        JupyterServerConnectionService
    );
    serviceManager.addBinding(IJupyterServerConnectionService, IExtensionSingleActivationService);
    serviceManager.addSingleton<NotebookCreator>(NotebookCreator, NotebookCreator);
    serviceManager.addSingleton<RemoteFileSystemFactory>(RemoteFileSystemFactory, RemoteFileSystemFactory);
    serviceManager.addSingleton<RemoteFileSchemeManager>(RemoteFileSchemeManager, RemoteFileSchemeManager);
    serviceManager.addBinding(RemoteFileSystemFactory, IExtensionSingleActivationService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        JupyterServersTreeView
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CommandRegistry);
}
