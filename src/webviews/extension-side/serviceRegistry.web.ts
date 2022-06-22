// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IWebviewViewProvider, IWebviewPanelProvider } from '../../platform/common/application/types';
import { IServiceManager } from '../../platform/ioc/types';
import { WebviewViewProvider } from './webviewViews/webviewViewProvider';
import { WebviewPanelProvider } from './webviewPanels/webviewPanelProvider';
import { IExtensionActivationManager, IExtensionSingleActivationService } from '../../platform/activation/types';
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
import { CommandRegistry as ExportCommandRegistry } from './import-export/commandRegistry';
import { NotebookWatcher } from './variablesView/notebookWatcher';
import { DataViewerFactory } from './dataviewer/dataViewerFactory';
import { ExtensionSideRenderer, IExtensionSideRenderer } from './renderer';
import { ActiveEditorContextService } from './activeEditorContext';
import { GlobalActivation } from './globalActivation';
import { DataViewer } from './dataviewer/dataViewer';
import { INotebookExporter } from '../../kernels/jupyter/types';
import { JupyterExporter } from './import-export/jupyterExporter';
import { JupyterKernelServiceFactory } from './api/kernelApi';
import { IExportedKernelServiceFactory } from './api/api';
import { ApiAccessService } from './api/apiAccessService';
import { ExtensionActivationManager } from './activationManager';
import { DataViewerDependencyService } from './dataviewer/dataViewerDependencyService';

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, GlobalActivation);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ActiveEditorContextService
    );

    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
    serviceManager.add<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);

    // Data viewer
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        DataViewerCommandRegistry
    );
    serviceManager.addSingleton<IDataViewerDependencyService>(
        IDataViewerDependencyService,
        DataViewerDependencyService
    );

    // Variables view
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

    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ExportCommandRegistry
    );

    serviceManager.addSingletonInstance<IExtensionSideRenderer>(IExtensionSideRenderer, new ExtensionSideRenderer());

    // Activation Manager
    serviceManager.add<IExtensionActivationManager>(IExtensionActivationManager, ExtensionActivationManager);
    serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);

    // API
    serviceManager.addSingleton<IExportedKernelServiceFactory>(
        IExportedKernelServiceFactory,
        JupyterKernelServiceFactory
    );
    serviceManager.addSingleton<ApiAccessService>(ApiAccessService, ApiAccessService);
}
