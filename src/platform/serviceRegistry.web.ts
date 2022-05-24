// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { ApplicationEnvironment } from './common/application/applicationEnvironment.web';
import { ApplicationShell } from './common/application/applicationShell';
import { CommandManager } from './common/application/commandManager';
import {
    ICommandManager,
    IWorkspaceService,
    IApplicationShell,
    IApplicationEnvironment
} from './common/application/types';
import { ConfigurationService } from './common/configuration/service.web';
import { registerTypes as registerApiTypes } from './api/serviceRegistry.web';
import { registerTypes as registerCommonTypes } from './common/serviceRegistry.web';
import { registerTypes as registerActivationTypes } from './activation/serviceRegistry.web';
import { registerTypes as registerDevToolTypes } from './devTools/serviceRegistry';
import { IConfigurationService, IDataScienceCommandListener, IExtensionContext } from './common/types';
import { IServiceManager } from './ioc/types';
import { ProgressReporter } from './progress/progressReporter';
import { StatusProvider } from './progress/statusProvider';
import { IStatusProvider } from './progress/types';
import { WorkspaceService } from './common/application/workspace.web';
import { DataScienceErrorHandler } from './errors/errorHandler';
import { IDataScienceErrorHandler } from './errors/types';
import { GlobalActivation } from './common/globalActivation';
import { IExtensionSingleActivationService } from './activation/types';
import { ExtensionSideRenderer, IExtensionSideRenderer } from '../webviews/extension-side/renderer';
import { OutputCommandListener } from './logging/outputCommandListener';
import { ExportDialog } from './export/exportDialog';
import { ExportFormat, IExport, IExportBase, IExportDialog, IFileConverter, INbConvertExport } from './export/types';
import { FileConverter } from './export/fileConverter';
import { ExportFileOpener } from './export/exportFileOpener';
import { ExportToPythonPlain } from './export/exportToPythonPlain';
import { IFileSystem } from './common/platform/types';
import { FileSystem } from './common/platform/fileSystem';
import { ExportBase } from './export/exportBase.web';
import { ExportUtilBase } from './export/exportUtil';
import { ExportToHTML } from './export/exportToHTML';
import { ExportToPDF } from './export/exportToPDF';
import { ExportToPython } from './export/exportToPython';
import { NotebookWatcher } from '../webviews/extension-side/variablesView/notebookWatcher';
import { DataViewerFactory } from '../webviews/extension-side/dataviewer/dataViewerFactory';
import { IDataViewerFactory } from '../webviews/extension-side/dataviewer/types';
import { INotebookWatcher } from '../webviews/extension-side/variablesView/types';
import { DebuggingManager } from '../notebooks/debugger/debuggingManager';
import { IDebuggingManager } from '../kernels/debugger/types';
import { InteractiveWindowDebuggingManager } from '../interactive-window/debugger/jupyter/debuggingManager';

export function registerTypes(context: IExtensionContext, serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IFileSystem>(IFileSystem, FileSystem);
    serviceManager.addSingleton<ICommandManager>(ICommandManager, CommandManager);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IApplicationShell>(IApplicationShell, ApplicationShell);
    serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);
    serviceManager.addSingleton<IStatusProvider>(IStatusProvider, StatusProvider);
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, GlobalActivation);
    serviceManager.addSingletonInstance<IExtensionSideRenderer>(IExtensionSideRenderer, new ExtensionSideRenderer());
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, OutputCommandListener);
    serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);
    serviceManager.addSingleton<IExportBase>(IExportBase, ExportBase);
    serviceManager.addSingleton<IExportDialog>(IExportDialog, ExportDialog);
    serviceManager.addSingleton<ProgressReporter>(ProgressReporter, ProgressReporter);
    serviceManager.addSingleton<IFileConverter>(IFileConverter, FileConverter);
    serviceManager.addSingleton<IExport>(IExport, ExportToPythonPlain, ExportFormat.python);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToHTML, ExportFormat.html);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPDF, ExportFormat.pdf);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPython, ExportFormat.python);
    serviceManager.addSingleton<ExportUtilBase>(ExportUtilBase, ExportUtilBase);

    registerCommonTypes(serviceManager);
    registerApiTypes(serviceManager);
    registerActivationTypes(serviceManager);
    registerDevToolTypes(context, serviceManager, isDevMode);

    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<INotebookWatcher>(INotebookWatcher, NotebookWatcher);

    serviceManager.addSingleton<IDebuggingManager>(IDebuggingManager, DebuggingManager, undefined, [
        IExtensionSingleActivationService
    ]);
    serviceManager.addSingleton<IDebuggingManager>(IDebuggingManager, InteractiveWindowDebuggingManager, undefined, [
        IExtensionSingleActivationService
    ]);
}
