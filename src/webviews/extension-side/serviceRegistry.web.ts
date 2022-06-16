// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IWebviewViewProvider, IWebviewPanelProvider } from '../../platform/common/application/types';
import { IServiceManager } from '../../platform/ioc/types';
import { WebviewViewProvider } from './webviewViews/webviewViewProvider';
import { WebviewPanelProvider } from './webviewPanels/webviewPanelProvider';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { VariableViewActivationService } from './variablesView/variableViewActivationService';
import { INotebookWatcher, IVariableViewProvider } from './variablesView/types';
import { VariableViewProvider } from './variablesView/variableViewProvider';
import { JupyterVariableDataProvider } from './dataviewer/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from './dataviewer/jupyterVariableDataProviderFactory';
import {
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

export function registerTypes(serviceManager: IServiceManager, _isDevMode: boolean) {
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        ActiveEditorContextService
    );

    serviceManager.add<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
    serviceManager.add<IWebviewPanelProvider>(IWebviewPanelProvider, WebviewPanelProvider);

    // Data viewer
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
}
