// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';
import { registerTypes as registerApiTypes } from './api/serviceRegistry';
import { registerTypes as commonRegisterTypes } from './common/serviceRegistry';
import { registerTypes as dataScienceRegisterTypes } from './datascience/serviceRegistry';
import { registerLoggerTypes } from './logging/serviceRegistry';
import { registerTypes as commonRegisterTerminalTypes } from './terminals/serviceRegistry';
import { registerTypes as activationRegisterTypes } from './activation/serviceRegistry';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    // Logging should be done first so we get logging going asap
    registerLoggerTypes(serviceManager);
    serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
    activationRegisterTypes(serviceManager);
    registerApiTypes(serviceManager);
    commonRegisterTypes(serviceManager);
    dataScienceRegisterTypes(serviceManager, isDevMode);
    commonRegisterTerminalTypes(serviceManager);
    serviceManager.addSingletonInstance<number>(DataScienceStartupTime, Date.now());

    // This file should go away soon.
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);
    serviceManager.addSingleton<DataViewerDependencyService>(DataViewerDependencyService, DataViewerDependencyService);
    serviceManager.addSingleton<ICodeCssGenerator>(ICodeCssGenerator, CodeCssGenerator);
    serviceManager.addSingleton<IDataScience>(IDataScience, GlobalActivation);
    serviceManager.addSingleton<IVariableViewProvider>(IVariableViewProvider, VariableViewProvider);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, GitHubIssueCommandListener);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Activation);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, VariableViewActivationService);
    if (isDevMode) {
        serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, LogReplayService);
    }
    serviceManager.addSingleton<IPlotViewerProvider>(IPlotViewerProvider, PlotViewerProvider);
    serviceManager.addSingleton<IStatusProvider>(IStatusProvider, StatusProvider);
    serviceManager.addSingleton<IThemeFinder>(IThemeFinder, ThemeFinder);
    serviceManager.addSingleton<ProgressReporter>(ProgressReporter, ProgressReporter);
    serviceManager.addSingleton<IFileConverter>(IFileConverter, FileConverter);
    serviceManager.addSingleton<ExportInterpreterFinder>(ExportInterpreterFinder, ExportInterpreterFinder);
    serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPDF, ExportFormat.pdf);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToHTML, ExportFormat.html);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPython, ExportFormat.python);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportBase, 'Export Base');
    serviceManager.addSingleton<IExport>(IExport, ExportToPythonPlain, ExportFormat.python);
    serviceManager.addSingleton<ExportUtil>(ExportUtil, ExportUtil);
    serviceManager.addSingleton<IExportDialog>(IExportDialog, ExportDialog);
    serviceManager.addSingleton<IFileSystemPathUtils>(IFileSystemPathUtils, FileSystemPathUtils);
    serviceManager.addSingleton<INotebookWatcher>(INotebookWatcher, NotebookWatcher);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, ExtensionRecommendationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelProgressReporter);
    serviceManager.addSingleton<IDebuggingManager>(IDebuggingManager, DebuggingManager, undefined, [IExtensionSingleActivationService]);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, PreReleaseChecker);
}
