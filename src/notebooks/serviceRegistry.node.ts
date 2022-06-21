// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { KernelFilterService } from './controllers/kernelFilter/kernelFilterService';
import { KernelFilterUI } from './controllers/kernelFilter/kernelFilterUI';
import { LiveKernelSwitcher } from './controllers/liveKernelSwitcher';
import { NotebookControllerManager } from './controllers/notebookControllerManager';
import { RemoteSwitcher } from './controllers/remoteSwitcher';
import { NotebookCommandListener } from './notebookCommandListener';
import { NotebookEditorProvider } from './notebookEditorProvider';
import { ErrorRendererCommunicationHandler } from './outputs/errorRendererComms.node';
import { PlotSaveHandler } from './outputs/plotSaveHandler.node';
import { PlotViewHandler } from './outputs/plotViewHandler.node';
import { RendererCommunication } from './outputs/rendererCommunication.node';
import { INotebookCompletionProvider, INotebookControllerManager, INotebookEditorProvider } from './types';
import { NotebookUsageTracker } from './notebookUsageTracker';
import { IDataScienceCommandListener } from '../platform/common/types';
import { CondaControllerRefresher } from './controllers/condaControllerRefresher.node';
import { IntellisenseProvider } from '../intellisense/intellisenseProvider.node';
import { RemoteKernelControllerWatcher } from './controllers/remoteKernelControllerWatcher';
import { ITracebackFormatter } from '../kernels/types';
import { NotebookTracebackFormatter } from './outputs/tracebackFormatter';
import { IJupyterDebugService } from '../kernels/debugger/types';
import { Identifiers } from '../platform/common/constants';
import { JupyterDebugService } from './debugger/jupyterDebugService.node';
import { NotebookIPyWidgetCoordinator } from './controllers/notebookIPyWidgetCoordinator';
import { RemoteKernelConnectionHandler } from './controllers/remoteKernelConnectionHandler';
import { JupyterServerSelectorCommand } from './serverSelector';
import { InterpreterPackageTracker } from './telemetry/interpreterPackageTracker';
import { InstallPythonControllerCommands } from './controllers/installPythonControllerCommands';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, RemoteSwitcher);
    serviceManager.addSingleton<INotebookControllerManager>(INotebookControllerManager, NotebookControllerManager);
    serviceManager.addSingleton<PlotSaveHandler>(PlotSaveHandler, PlotSaveHandler);
    serviceManager.addSingleton<PlotViewHandler>(PlotViewHandler, PlotViewHandler);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSyncActivationService,
        RendererCommunication
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelFilterUI);
    serviceManager.addBinding(INotebookControllerManager, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        CondaControllerRefresher
    );

    serviceManager.addSingleton<KernelFilterService>(KernelFilterService, KernelFilterService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        LiveKernelSwitcher
    );
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, NotebookCommandListener);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ErrorRendererCommunicationHandler
    );
    serviceManager.addSingleton<INotebookEditorProvider>(INotebookEditorProvider, NotebookEditorProvider);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookUsageTracker
    );
    serviceManager.addSingleton<INotebookCompletionProvider>(INotebookCompletionProvider, IntellisenseProvider);
    serviceManager.addBinding(INotebookCompletionProvider, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteKernelControllerWatcher
    );
    serviceManager.addSingleton<ITracebackFormatter>(ITracebackFormatter, NotebookTracebackFormatter);
    serviceManager.addSingleton<IJupyterDebugService>(
        IJupyterDebugService,
        JupyterDebugService,
        Identifiers.RUN_BY_LINE_DEBUGSERVICE
    );
    serviceManager.addSingleton<NotebookIPyWidgetCoordinator>(
        NotebookIPyWidgetCoordinator,
        NotebookIPyWidgetCoordinator
    );
    serviceManager.addBinding(NotebookIPyWidgetCoordinator, IExtensionSyncActivationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        RemoteKernelConnectionHandler
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        JupyterServerSelectorCommand
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        InterpreterPackageTracker
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        InstallPythonControllerCommands
    );
}
