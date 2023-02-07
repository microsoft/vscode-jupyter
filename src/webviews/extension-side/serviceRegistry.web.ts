// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { VariableViewActivationService } from './variablesView/variableViewActivationService';
import { INotebookWatcher, IVariableViewProvider } from './variablesView/types';
import { VariableViewProvider } from './variablesView/variableViewProvider';
import { JupyterVariableDataProvider } from './dataviewer/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from './dataviewer/jupyterVariableDataProviderFactory';
import {
    IDataViewer,
    IDataViewerDependencyService,
    IDataViewerFactory,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory
} from './dataviewer/types';
import { DataViewerCommandRegistry } from './dataviewer/dataViewerCommandRegistry';
import { NotebookWatcher } from './variablesView/notebookWatcher';
import { DataViewerFactory } from './dataviewer/dataViewerFactory';
import { DataViewer } from './dataviewer/dataViewer';
import { IServiceManager } from '../../platform/ioc/types';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../../platform/activation/types';
import { DataViewerDependencyService } from './dataviewer/dataViewerDependencyService';
import { IPlotViewer, IPlotViewerProvider } from './plotting/types';
import { PlotViewer } from './plotting/plotViewer';
import { PlotViewerProvider } from './plotting/plotViewerProvider';
import { PlotSaveHandler } from './plotView/plotSaveHandler';
import { PlotViewHandler } from './plotView/plotViewHandler';
import { RendererCommunication } from './plotView/rendererCommunication';
import { IPlotSaveHandler } from './plotView/types';
import { IPyWidgetRendererComms } from './ipywidgets/rendererComms';
// import { ExtensionSideRenderer } from './error-renderer';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSyncActivationService,
        RendererCommunication
    );

    // Data viewer
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        DataViewerCommandRegistry
    );
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<IDataViewerDependencyService>(
        IDataViewerDependencyService,
        DataViewerDependencyService
    );

    // Plot Viewer
    serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);
    serviceManager.addSingleton<IPlotViewerProvider>(IPlotViewerProvider, PlotViewerProvider);
    serviceManager.addSingleton<IPlotSaveHandler>(IPlotSaveHandler, PlotSaveHandler);
    serviceManager.addSingleton<PlotViewHandler>(PlotViewHandler, PlotViewHandler);

    // Variables view
    serviceManager.addSingleton<INotebookWatcher>(INotebookWatcher, NotebookWatcher);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        VariableViewActivationService
    );
    // serviceManager.addSingleton<IExtensionSyncActivationService>(
    //     IExtensionSyncActivationService,
    //     ExtensionSideRenderer
    // );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        IPyWidgetRendererComms
    );
    serviceManager.addSingleton<IVariableViewProvider>(IVariableViewProvider, VariableViewProvider);
    serviceManager.add<IJupyterVariableDataProvider>(IJupyterVariableDataProvider, JupyterVariableDataProvider);
    serviceManager.addSingleton<IJupyterVariableDataProviderFactory>(
        IJupyterVariableDataProviderFactory,
        JupyterVariableDataProviderFactory
    );
}
