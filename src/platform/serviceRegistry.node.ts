// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../platform/ioc/types';
import { registerTypes as registerApiTypes } from './api/serviceRegistry.node';
import { registerTypes as registerCommonTypes } from './common/serviceRegistry.node';
import { registerTypes as registerTerminalTypes } from './terminals/serviceRegistry.node';
import { registerTypes as registerActivationTypes } from './activation/serviceRegistry.node';
import { registerTypes as registerDevToolTypes } from './devTools/serviceRegistry';
import { DataScienceStartupTime } from './common/constants';
import { LogReplayService } from '../intellisense/logReplayService.node';
import { Activation } from '../kernels/activation.node';
import { DataViewer } from '../webviews/extension-side/dataviewer/dataViewer.node';
import { DataViewerDependencyService } from '../webviews/extension-side/dataviewer/dataViewerDependencyService.node';
import { DataViewerFactory } from '../webviews/extension-side/dataviewer/dataViewerFactory';
import {
    IDataViewer,
    IDataViewerDependencyService,
    IDataViewerFactory
} from '../webviews/extension-side/dataviewer/types';
import { PlotViewer } from '../webviews/extension-side/plotting/plotViewer.node';
import { PlotViewerProvider } from '../webviews/extension-side/plotting/plotViewerProvider.node';
import { IPlotViewer, IPlotViewerProvider } from '../webviews/extension-side/plotting/types';
import { NotebookWatcher } from '../webviews/extension-side/variablesView/notebookWatcher';
import { INotebookWatcher } from '../webviews/extension-side/variablesView/types';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from './activation/types';
import { ExtensionRecommendationService } from './common/extensionRecommendation.node';
import { GlobalActivation } from './common/globalActivation';
import { PreReleaseChecker } from './common/prereleaseChecker.node';
import { IConfigurationService, IDataScienceCommandListener, IExtensionContext } from './common/types';
import { DebugLocationTrackerFactory } from '../kernels/debugger/debugLocationTrackerFactory';
import { DataScienceErrorHandler } from './errors/errorHandler';
import { IDataScienceErrorHandler } from './errors/types';
import { ExportBase } from './export/exportBase.node';
import { ExportDialog } from './export/exportDialog';
import { ExportFileOpener } from './export/exportFileOpener';
import { ExportInterpreterFinder } from './export/exportInterpreterFinder.node';
import { ExportToHTML } from './export/exportToHTML';
import { ExportToPDF } from './export/exportToPDF';
import { ExportToPython } from './export/exportToPython';
import { ExportToPythonPlain } from './export/exportToPythonPlain';
import { ExportUtil } from './export/exportUtil.node';
import { FileConverter } from './export/fileConverter.node';
import { IFileConverter, INbConvertExport, ExportFormat, IExport, IExportDialog, IExportBase } from './export/types';
import { KernelProgressReporter } from './progress/kernelProgressReporter';
import { ProgressReporter } from './progress/progressReporter';
import { StatusProvider } from './progress/statusProvider';
import { IStatusProvider } from './progress/types';
import { ApplicationShell } from './common/application/applicationShell';
import { CommandManager } from './common/application/commandManager';
import { ICommandManager, IWorkspaceService, IApplicationShell } from './common/application/types';
import { ConfigurationService } from './common/configuration/service.node';
import { IFileSystem } from './common/platform/types';
import { IFileSystemNode } from './common/platform/types.node';
import { FileSystem } from './common/platform/fileSystem.node';
import { WorkspaceService } from './common/application/workspace.node';
import { ExtensionSideRenderer, IExtensionSideRenderer } from '../webviews/extension-side/renderer';
import { OutputCommandListener } from './logging/outputCommandListener';
import { ExportUtilBase } from './export/exportUtil';
import { DebuggingManager } from '../notebooks/debugger/debuggingManager';
import {
    IDebuggingManager,
    IDebugLocationTracker,
    IDebugLocationTrackerFactory,
    IInteractiveWindowDebuggingManager
} from '../kernels/debugger/types';
import { InteractiveWindowDebuggingManager } from '../interactive-window/debugger/jupyter/debuggingManager';

export function registerTypes(context: IExtensionContext, serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<FileSystem>(FileSystem, FileSystem);
    serviceManager.addBinding(FileSystem, IFileSystemNode);
    serviceManager.addBinding(FileSystem, IFileSystem);
    serviceManager.addSingleton<ICommandManager>(ICommandManager, CommandManager);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IApplicationShell>(IApplicationShell, ApplicationShell);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);

    registerActivationTypes(serviceManager);
    registerApiTypes(serviceManager);
    registerCommonTypes(serviceManager);
    registerTerminalTypes(serviceManager);
    registerDevToolTypes(context, serviceManager, isDevMode);

    // Root platform types
    serviceManager.addSingletonInstance<number>(DataScienceStartupTime, Date.now());
    serviceManager.addSingletonInstance<IExtensionSideRenderer>(IExtensionSideRenderer, new ExtensionSideRenderer());
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);
    serviceManager.addSingleton<IDataViewerDependencyService>(
        IDataViewerDependencyService,
        DataViewerDependencyService
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, GlobalActivation);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory, undefined, [
        IDebugLocationTrackerFactory
    ]);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Activation);
    if (isDevMode) {
        serviceManager.addSingleton<IExtensionSingleActivationService>(
            IExtensionSingleActivationService,
            LogReplayService
        );
    }
    serviceManager.addSingleton<IPlotViewerProvider>(IPlotViewerProvider, PlotViewerProvider);
    serviceManager.addSingleton<IStatusProvider>(IStatusProvider, StatusProvider);
    serviceManager.addSingleton<ProgressReporter>(ProgressReporter, ProgressReporter);
    serviceManager.addSingleton<IFileConverter>(IFileConverter, FileConverter);
    serviceManager.addSingleton<ExportInterpreterFinder>(ExportInterpreterFinder, ExportInterpreterFinder);
    serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);

    serviceManager.addSingleton<IExportBase>(IExportBase, ExportBase);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPDF, ExportFormat.pdf);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToHTML, ExportFormat.html);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPython, ExportFormat.python);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportBase, 'Export Base');
    serviceManager.addSingleton<IExport>(IExport, ExportToPythonPlain, ExportFormat.python);
    serviceManager.addSingleton<ExportUtilBase>(ExportUtilBase, ExportUtilBase);
    serviceManager.addSingleton<ExportUtil>(ExportUtil, ExportUtil);
    serviceManager.addSingleton<IExportDialog>(IExportDialog, ExportDialog);
    serviceManager.addSingleton<INotebookWatcher>(INotebookWatcher, NotebookWatcher);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        ExtensionRecommendationService
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelProgressReporter
    );
    serviceManager.addSingleton<IDebuggingManager>(IDebuggingManager, DebuggingManager, undefined, [
        IExtensionSingleActivationService
    ]);
    serviceManager.addSingleton<IInteractiveWindowDebuggingManager>(
        IInteractiveWindowDebuggingManager,
        InteractiveWindowDebuggingManager,
        undefined,
        [IExtensionSingleActivationService]
    );
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        PreReleaseChecker
    );
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, OutputCommandListener);
}
