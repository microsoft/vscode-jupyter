// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../../platform/activation/types';
import { IServiceManager } from '../../platform/ioc/types';
import { DataViewer } from './dataviewer/dataViewer';
import { DataViewerCommandRegistry } from './dataviewer/dataViewerCommandRegistry';
import { DataViewerDependencyService } from './dataviewer/dataViewerDependencyService.node';
import { DataViewerFactory } from './dataviewer/dataViewerFactory';
import { JupyterVariableDataProvider } from './dataviewer/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from './dataviewer/jupyterVariableDataProviderFactory';
import {
    IDataViewer,
    IDataViewerDependencyService,
    IDataViewerFactory,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory
} from './dataviewer/types';
import { PlotViewer } from './plotting/plotViewer.node';
import { PlotViewerProvider } from './plotting/plotViewerProvider';
import { IPlotViewer, IPlotViewerProvider } from './plotting/types';
import { PlotSaveHandler } from './plotView/plotSaveHandler.node';
import { PlotViewHandler } from './plotView/plotViewHandler';
import { RendererCommunication } from './plotView/rendererCommunication';
import { IPlotSaveHandler } from './plotView/types';
import { NotebookWatcher } from './variablesView/notebookWatcher';
import { INotebookWatcher, IVariableViewProvider } from './variablesView/types';
import { VariableViewActivationService } from './variablesView/variableViewActivationService';
import { VariableViewProvider } from './variablesView/variableViewProvider';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSyncActivationService,
        RendererCommunication
    );

    // Data Viewer
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<IDataViewerDependencyService>(
        IDataViewerDependencyService,
        DataViewerDependencyService
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        DataViewerCommandRegistry
    );

    // Plot Viewer
    serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);
    serviceManager.addSingleton<IPlotViewerProvider>(IPlotViewerProvider, PlotViewerProvider);
    serviceManager.addSingleton<IPlotSaveHandler>(IPlotSaveHandler, PlotSaveHandler);
    serviceManager.addSingleton<PlotViewHandler>(PlotViewHandler, PlotViewHandler);

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
}
