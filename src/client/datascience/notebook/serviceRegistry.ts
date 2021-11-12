// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../../activation/types';
import { IServiceManager } from '../../ioc/types';
import { GitHubIssueCodeLensProvider } from '../../logging/gitHubIssueCodeLensProvider';
import { KernelProvider } from '../jupyter/kernels/kernelProvider';
import { IKernelProvider } from '../jupyter/kernels/types';
import { CreationOptionService } from './creation/creationOptionsService';
import { NotebookCreator } from './creation/notebookCreator';
import { NotebookCellLanguageService } from './cellLanguageService';
import { EmptyNotebookCellLanguageService } from './emptyNotebookCellLanguageService';
import { NotebookIntegration } from './integration';
import { PythonKernelCompletionProvider } from './intellisense/pythonKernelCompletionProvider';
import { NotebookControllerManager } from './notebookControllerManager';
import { NotebookDisposeService } from './notebookDisposeService';
import { RemoteSwitcher } from './remoteSwitcher';
import { INotebookControllerManager, INotebookLanguageClientProvider } from './types';
import { RendererCommunication } from './outputs/rendererCommunication';
import { PlotSaveHandler } from './outputs/plotSaveHandler';
import { PlotViewHandler } from './outputs/plotViewHandler';
import { CellOutputDisplayIdTracker } from '../jupyter/kernels/cellDisplayIdTracker';
import { IntellisenseProvider } from './intellisense/intellisenseProvider';
import { KernelFilterUI } from './kernelFilter/kernelFilterUI';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import { NotebookCellBangInstallDiagnosticsProvider } from './bangInstallDiagnostics/diagnosticsProvider';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookIntegration
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookDisposeService
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, RemoteSwitcher);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        EmptyNotebookCellLanguageService
    );
    serviceManager.addSingleton<NotebookIntegration>(NotebookIntegration, NotebookIntegration);
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
    serviceManager.addSingleton<CreationOptionService>(CreationOptionService, CreationOptionService);
    serviceManager.addSingleton<NotebookCreator>(NotebookCreator, NotebookCreator);
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
}
