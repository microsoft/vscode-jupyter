// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IWebviewViewProvider, IWebviewPanelProvider } from '../platform/common/application/types';
import { IServiceManager } from '../platform/ioc/types';
import { WebviewViewProvider } from '../platform/webviewHost/webviewViewProvider';
import { WebviewPanelProvider } from '../platform/webviewHost/webviewPanelProvider';
import { IExtensionActivationManager, IExtensionSingleActivationService } from '../platform/activation/types';
import { VariableViewActivationService } from '../webviews/extension-side/variablesView/variableViewActivationService';
import { INotebookWatcher, IVariableViewProvider } from '../webviews/extension-side/variablesView/types';
import { VariableViewProvider } from '../webviews/extension-side/variablesView/variableViewProvider';
import { JupyterVariableDataProvider } from '../webviews/extension-side/dataviewer/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from '../webviews/extension-side/dataviewer/jupyterVariableDataProviderFactory';
import {
    IDataViewer,
    IDataViewerFactory,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory
} from '../webviews/extension-side/dataviewer/types';
import { DataViewerCommandRegistry } from '../webviews/extension-side/dataviewer/dataViewerCommandRegistry';
import { CommandRegistry as ExportCommandRegistry } from './import-export/commandRegistry';
import { NotebookWatcher } from '../webviews/extension-side/variablesView/notebookWatcher';
import { DataViewerFactory } from '../webviews/extension-side/dataviewer/dataViewerFactory';
import { ExtensionSideRenderer, IExtensionSideRenderer } from './renderer';
import { ActiveEditorContextService } from './context/activeEditorContext';
import { GlobalActivation } from './activation/globalActivation';
import { DataViewer } from '../webviews/extension-side/dataviewer/dataViewer';
import { INotebookExporter } from '../kernels/jupyter/types';
import { JupyterExporter } from './import-export/jupyterExporter';
import { JupyterKernelServiceFactory } from './api/kernelApi';
import { IExportedKernelServiceFactory } from './api/api';
import { ApiAccessService } from './api/apiAccessService';
import { ExtensionActivationManager } from './activation/activationManager';
import { registerTypes as registerDevToolTypes } from './devTools/serviceRegistry';
import { IExtensionContext } from '../platform/common/types';

export function registerTypes(context: IExtensionContext, serviceManager: IServiceManager, isDevMode: boolean) {
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

    // Dev Tools
    registerDevToolTypes(context, serviceManager, isDevMode);
}
