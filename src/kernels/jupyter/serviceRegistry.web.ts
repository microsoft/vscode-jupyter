// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IServiceManager } from '../../platform/ioc/types';
import { IRemoteKernelFinder } from '../raw/types';
import { INotebookProvider } from '../types';
import { JupyterKernelService } from './jupyterKernelService.web';
import { JupyterUriProviderRegistration } from './jupyterUriProviderRegistration';
import { JupyterPasswordConnect } from './launcher/jupyterPasswordConnect';
import { NotebookProvider } from './launcher/notebookProvider';
import { JupyterServerUriStorage } from './launcher/serverUriStorage';
import { RemoteKernelFinder } from './remoteKernelFinder';
import { JupyterServerSelector } from './serverSelector';
import { BackingFileCreator } from './session/backingFileCreator.web';
import { JupyterSessionManagerFactory } from './session/jupyterSessionManagerFactory';
import {
    IJupyterPasswordConnect,
    IJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration,
    IJupyterServerUriStorage,
    IJupyterBackingFileCreator,
    IJupyterKernelService
} from './types';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IRemoteKernelFinder>(IRemoteKernelFinder, RemoteKernelFinder);
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
}
