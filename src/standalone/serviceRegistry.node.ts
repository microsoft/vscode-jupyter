// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import {
    IExtensionActivationManager,
    IExtensionSingleActivationService,
    IExtensionSyncActivationService
} from '../platform/activation/types';
import { IWebviewViewProvider, IWebviewPanelProvider } from '../platform/common/application/types';
import { IServiceManager } from '../platform/ioc/types';
import { INotebookWatcher, IVariableViewProvider } from '../webviews/extension-side/variablesView/types';
import { VariableViewActivationService } from '../webviews/extension-side/variablesView/variableViewActivationService';
import { VariableViewProvider } from '../webviews/extension-side/variablesView/variableViewProvider';
import { WebviewPanelProvider } from '../platform/webviewHost/webviewPanelProvider';
import { WebviewViewProvider } from '../platform/webviewHost/webviewViewProvider';
import { JupyterVariableDataProvider } from '../webviews/extension-side/dataviewer/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from '../webviews/extension-side/dataviewer/jupyterVariableDataProviderFactory';
import {
    IDataViewer,
    IDataViewerDependencyService,
    IDataViewerFactory,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory
} from '../webviews/extension-side/dataviewer/types';
import { INotebookExporter, INotebookImporter } from '../kernels/jupyter/types';
import { JupyterExporter } from './import-export/jupyterExporter';
import { JupyterImporter } from './import-export/jupyterImporter.node';
import { CommandRegistry as ExportCommandRegistry } from './import-export/commandRegistry';
import { ServerPreload } from './serverPreload/serverPreload.node';
import { RendererCommunication } from '../webviews/extension-side/plotView/rendererCommunication.node';
import { PlotSaveHandler } from '../webviews/extension-side/plotView/plotSaveHandler.node';
import { PlotViewHandler } from '../webviews/extension-side/plotView/plotViewHandler.node';
import { DataViewerCommandRegistry } from '../webviews/extension-side/dataviewer/dataViewerCommandRegistry';
import { DataViewer } from '../webviews/extension-side/dataviewer/dataViewer';
import { IPlotViewer, IPlotViewerProvider } from '../webviews/extension-side/plotting/types';
import { PlotViewer } from '../webviews/extension-side/plotting/plotViewer.node';
import { DataViewerDependencyService } from '../webviews/extension-side/dataviewer/dataViewerDependencyService.node';
import { PlotViewerProvider } from '../webviews/extension-side/plotting/plotViewerProvider.node';
import { DataViewerFactory } from '../webviews/extension-side/dataviewer/dataViewerFactory';
import { NotebookWatcher } from '../webviews/extension-side/variablesView/notebookWatcher';
import { ExtensionSideRenderer, IExtensionSideRenderer } from './renderer';
import { ExtensionRecommendationService } from './recommendation/extensionRecommendation.node';
import { ActiveEditorContextService } from './context/activeEditorContext';
import { AmlComputeContext } from './context/amlContext.node';
import { IImportTracker, ImportTracker } from './import-export/importTracker.node';
import { GlobalActivation } from './activation/globalActivation';
import { JupyterKernelServiceFactory } from './api/kernelApi';
import { IExportedKernelServiceFactory } from './api/api';
import { ApiAccessService } from './api/apiAccessService';
import { WorkspaceActivation } from './activation/workspaceActivation.node';
import { ExtensionActivationManager } from './activation/activationManager';
import { DataScienceSurveyBanner, ISurveyBanner } from './survey/dataScienceSurveyBanner.node';
import { IExtensionContext } from '../platform/common/types';
import { registerTypes as registerDevToolTypes } from './devTools/serviceRegistry';

export function registerTypes(context: IExtensionContext, serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, GlobalActivation);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, ServerPreload);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        WorkspaceActivation
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSyncActivationService,
        RendererCommunication
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ExtensionRecommendationService
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ActiveEditorContextService
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        AmlComputeContext
    );
    serviceManager.addSingleton<AmlComputeContext>(AmlComputeContext, AmlComputeContext);
    serviceManager.addSingleton<IImportTracker>(IImportTracker, ImportTracker);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, ImportTracker);
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);
    serviceManager.addSingleton<IPlotViewerProvider>(IPlotViewerProvider, PlotViewerProvider);
    serviceManager.addSingleton<PlotSaveHandler>(PlotSaveHandler, PlotSaveHandler);
    serviceManager.addSingleton<PlotViewHandler>(PlotViewHandler, PlotViewHandler);

    serviceManager.addSingleton<IDataViewerDependencyService>(
        IDataViewerDependencyService,
        DataViewerDependencyService
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        DataViewerCommandRegistry
    );

    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
    serviceManager.add<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);

    // Variable View
    serviceManager.addSingleton<INotebookWatcher>(INotebookWatcher, NotebookWatcher);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        VariableViewActivationService
    );
    serviceManager.addSingleton<IVariableViewProvider>(IVariableViewProvider, VariableViewProvider);
    serviceManager.add<IJupyterVariableDataProvider>(IJupyterVariableDataProvider, JupyterVariableDataProvider);
    serviceManager.addSingleton<IJupyterVariableDataProviderFactory>(
        IJupyterVariableDataProviderFactory,
        JupyterVariableDataProviderFactory
    );

    // Import/Export
    serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);
    serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ExportCommandRegistry
    );

    serviceManager.addSingletonInstance<IExtensionSideRenderer>(IExtensionSideRenderer, new ExtensionSideRenderer());

    serviceManager.addSingleton<ISurveyBanner>(ISurveyBanner, DataScienceSurveyBanner);
    serviceManager.addBinding(ISurveyBanner, IExtensionSingleActivationService);
    // Activation Manager
    serviceManager.add<IExtensionActivationManager>(IExtensionActivationManager, ExtensionActivationManager);

    // API
    serviceManager.addSingleton<IExportedKernelServiceFactory>(
        IExportedKernelServiceFactory,
        JupyterKernelServiceFactory
    );
    serviceManager.addSingleton<ApiAccessService>(ApiAccessService, ApiAccessService);

    // Dev Tools
    registerDevToolTypes(context, serviceManager, isDevMode);
}
