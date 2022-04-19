// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { IRemoteKernelFinder } from '../raw/types';
import { INotebookProvider } from '../types';
import { JupyterExporter } from './import-export/jupyterExporter.node';
import { JupyterImporter } from './import-export/jupyterImporter.node';
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
import { CellOutputMimeTypeTracker } from './jupyterCellOutputMimeTypeTracker.node';
import { JupyterKernelService } from './jupyterKernelService.node';
import { JupyterUriProviderRegistration } from './jupyterUriProviderRegistration';
import { JupyterCommandLineSelector } from './launcher/commandLineSelector.node';
import { JupyterNotebookProvider } from './launcher/jupyterNotebookProvider.node';
import { JupyterPasswordConnect } from './launcher/jupyterPasswordConnect';
import { HostJupyterExecution } from './launcher/liveshare/hostJupyterExecution.node';
import { HostJupyterServer } from './launcher/liveshare/hostJupyterServer.node';
import { NotebookProvider } from './launcher/notebookProvider';
import { NotebookServerProvider } from './launcher/notebookServerProvider.node';
import { NotebookStarter } from './launcher/notebookStarter.node';
import { ServerPreload } from './launcher/serverPreload.node';
import { JupyterServerUriStorage } from './launcher/serverUriStorage';
import { RemoteKernelFinder } from './remoteKernelFinder';
import { JupyterServerSelector } from './serverSelector';
import { BackingFileCreator } from './session/backingFileCreator.node';
import { JupyterSessionManagerFactory } from './session/jupyterSessionManagerFactory';
import {
    INotebookExporter,
    INotebookImporter,
    INotebookServer,
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
    IJupyterKernelService
} from './types';
import { IJupyterCommandFactory, IJupyterSubCommandExecutionService } from './types.node';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.add<IJupyterCommandFactory>(IJupyterCommandFactory, JupyterCommandFactory);
    serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);
    serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
    serviceManager.add<INotebookServer>(INotebookServer, HostJupyterServer);
    serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);
    serviceManager.addSingleton<IRemoteKernelFinder>(IRemoteKernelFinder, RemoteKernelFinder);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        CellOutputMimeTypeTracker
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        JupyterInterpreterSelectionCommand
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
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
    serviceManager.addSingleton<NotebookStarter>(NotebookStarter, NotebookStarter);
    serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, ServerPreload);
    serviceManager.addSingleton<IJupyterBackingFileCreator>(IJupyterBackingFileCreator, BackingFileCreator);
}
