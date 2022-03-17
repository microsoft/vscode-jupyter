// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../client/activation/types';
import { IDataScienceCommandListener, INotebookEditorProvider } from '../client/datascience/types';
import { IServiceManager } from '../client/ioc/types';
import { GitHubIssueCodeLensProvider } from '../client/logging/gitHubIssueCodeLensProvider';
import { NotebookCellLanguageService } from '../intellisense/cellLanguageService';
import { NotebookCellBangInstallDiagnosticsProvider } from '../intellisense/diagnosticsProvider';
import { EmptyNotebookCellLanguageService } from '../intellisense/emptyNotebookCellLanguageService';
import { IntellisenseProvider } from '../intellisense/intellisenseProvider';
import { PythonKernelCompletionProvider } from '../intellisense/pythonKernelCompletionProvider';
import { KernelProvider } from '../kernels/kernelProvider';
import { IKernelProvider } from '../kernels/types';
import { KernelFilterService } from './controllers/kernelFilter/kernelFilterService';
import { KernelFilterUI } from './controllers/kernelFilter/kernelFilterUI';
import { LiveKernelSwitcher } from './controllers/liveKernelSwitcher';
import { NotebookControllerManager } from './controllers/notebookControllerManager';
import { RemoteSwitcher } from './controllers/remoteSwitcher';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { NotebookCommandListener } from './notebookCommandListener';
import { NotebookEditorProvider } from './notebookEditorProvider';
import { ErrorRendererCommunicationHandler } from './outputs/errorRendererComms';
import { PlotSaveHandler } from './outputs/plotSaveHandler';
import { PlotViewHandler } from './outputs/plotViewHandler';
import { RendererCommunication } from './outputs/rendererCommunication';
import { INotebookLanguageClientProvider, INotebookControllerManager } from './types';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, RemoteSwitcher);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        EmptyNotebookCellLanguageService
    );
    serviceManager.addSingleton<IKernelProvider>(IKernelProvider, KernelProvider);
    serviceManager.addSingleton<CellOutputDisplayIdTracker>(CellOutputDisplayIdTracker, CellOutputDisplayIdTracker);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        GitHubIssueCodeLensProvider
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookCellLanguageService
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        NotebookCellBangInstallDiagnosticsProvider
    );
    serviceManager.addSingleton<NotebookCellLanguageService>(NotebookCellLanguageService, NotebookCellLanguageService);
    serviceManager.addSingleton<PythonKernelCompletionProvider>(
        PythonKernelCompletionProvider,
        PythonKernelCompletionProvider
    );
    serviceManager.addSingleton<INotebookLanguageClientProvider>(INotebookLanguageClientProvider, IntellisenseProvider);
    serviceManager.addBinding(INotebookLanguageClientProvider, IExtensionSingleActivationService);
    serviceManager.addSingleton<INotebookControllerManager>(INotebookControllerManager, NotebookControllerManager);
    serviceManager.addSingleton<PlotSaveHandler>(PlotSaveHandler, PlotSaveHandler);
    serviceManager.addSingleton<PlotViewHandler>(PlotViewHandler, PlotViewHandler);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSyncActivationService,
        RendererCommunication
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelFilterUI);
    serviceManager.addBinding(INotebookControllerManager, IExtensionSyncActivationService);

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
}
