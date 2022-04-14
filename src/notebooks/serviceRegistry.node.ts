// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../platform/activation/types';
import { IServiceManager } from '../platform/ioc/types';
import { GitHubIssueCodeLensProvider } from '../platform/logging/gitHubIssueCodeLensProvider.node';
import { NotebookCellLanguageService } from '../intellisense/cellLanguageService';
import { NotebookCellBangInstallDiagnosticsProvider } from '../intellisense/diagnosticsProvider.node';
import { EmptyNotebookCellLanguageService } from '../intellisense/emptyNotebookCellLanguageService.node';
import { IntellisenseProvider } from '../intellisense/intellisenseProvider.node';
import { KernelProvider } from '../kernels/kernelProvider.node';
import { IKernelProvider } from '../kernels/types';
import { KernelFilterService } from './controllers/kernelFilter/kernelFilterService';
import { KernelFilterUI } from './controllers/kernelFilter/kernelFilterUI';
import { LiveKernelSwitcher } from './controllers/liveKernelSwitcher';
import { NotebookControllerManager } from './controllers/notebookControllerManager';
import { RemoteSwitcher } from './controllers/remoteSwitcher';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { NotebookCommandListener } from './notebookCommandListener.node';
import { NotebookEditorProvider } from './notebookEditorProvider.node';
import { ErrorRendererCommunicationHandler } from './outputs/errorRendererComms.node';
import { PlotSaveHandler } from './outputs/plotSaveHandler.node';
import { PlotViewHandler } from './outputs/plotViewHandler.node';
import { RendererCommunication } from './outputs/rendererCommunication.node';
import { INotebookLanguageClientProvider, INotebookControllerManager, INotebookEditorProvider } from './types';
import { NotebookUsageTracker } from './notebookUsageTracker.node';
import { IDataScienceCommandListener } from '../platform/common/types';

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
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookUsageTracker
    );
}
