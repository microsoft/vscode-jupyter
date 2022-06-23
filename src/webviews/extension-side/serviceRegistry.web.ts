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
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { DataViewerDependencyService } from './dataviewer/dataViewerDependencyService';

export function registerTypes(serviceManager: IServiceManager) {
    // Data viewer
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        DataViewerCommandRegistry
    );
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
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
}
