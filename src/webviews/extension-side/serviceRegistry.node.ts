// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../../platform/activation/types';
import { IWebviewViewProvider, IWebviewPanelProvider } from '../../platform/common/application/types';
import { IServiceManager } from '../../platform/ioc/types';
import { INotebookWatcher, IVariableViewProvider } from './variablesView/types';
import { VariableViewActivationService } from './variablesView/variableViewActivationService';
import { VariableViewProvider } from './variablesView/variableViewProvider';
import { WebviewPanelProvider } from './webviewPanels/webviewPanelProvider';
import { WebviewViewProvider } from './webviewViews/webviewViewProvider';
import { JupyterVariableDataProvider } from './dataviewer/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from './dataviewer/jupyterVariableDataProviderFactory';
import {
    IDataViewer,
    IDataViewerDependencyService,
    IDataViewerFactory,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory
} from './dataviewer/types';
import { INotebookExporter, INotebookImporter } from '../../kernels/jupyter/types';
import { JupyterExporter } from './import-export/jupyterExporter.node';
import { JupyterImporter } from './import-export/jupyterImporter.node';
import { CommandRegistry as ExportCommandRegistry } from './import-export/commandRegistry';
import { ServerPreload } from './serverPreload/serverPreload.node';
import { RendererCommunication } from './plotView/rendererCommunication.node';
import { PlotSaveHandler } from './plotView/plotSaveHandler.node';
import { PlotViewHandler } from './plotView/plotViewHandler.node';
import { DataViewerCommandRegistry } from './dataviewer/dataViewerCommandRegistry';
import { DataViewer } from './dataviewer/dataViewer.node';
import { IPlotViewer, IPlotViewerProvider } from './plotting/types';
import { PlotViewer } from './plotting/plotViewer.node';
import { DataViewerDependencyService } from './dataviewer/dataViewerDependencyService.node';
import { PlotViewerProvider } from './plotting/plotViewerProvider.node';
import { DataViewerFactory } from './dataviewer/dataViewerFactory';
import { NotebookWatcher } from './variablesView/notebookWatcher';
import { ExtensionSideRenderer, IExtensionSideRenderer } from './renderer';
import { ExtensionRecommendationService } from './extensionRecommendation.node';
import { ActiveEditorContextService } from './activeEditorContext';
import { AmlComputeContext } from './amlContext.node';
import { IImportTracker, ImportTracker } from './importTracker.node';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, ServerPreload);
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
}
