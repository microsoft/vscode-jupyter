// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../activation/types';
import { FileSystemPathUtils } from '../common/platform/fs-paths';
import { IFileSystemPathUtils } from '../common/platform/types';
import { IServiceManager } from '../ioc/types';
import { GitHubIssueCommandListener } from '../logging/gitHubIssueCommandListener';
import { Activation } from './activation';
import { CodeCssGenerator } from './codeCssGenerator';
import { DataScienceStartupTime } from './constants';
import { DataViewer } from './data-viewing/dataViewer';
import { DataViewerDependencyService } from './data-viewing/dataViewerDependencyService';
import { DataViewerFactory } from './data-viewing/dataViewerFactory';
import { IDataViewer, IDataViewerFactory } from './data-viewing/types';
import { GlobalActivation } from './datascience';
import { DebugLocationTrackerFactory } from './debugLocationTrackerFactory';
import { DataScienceErrorHandler } from '../../platform/errors/errorHandler';
import { ExportBase } from './export/exportBase';
import { ExportDialog } from './export/exportDialog';
import { ExportFileOpener } from './export/exportFileOpener';
import { ExportInterpreterFinder } from './export/exportInterpreterFinder';
import { FileConverter } from './export/fileConverter';
import { ExportToHTML } from './export/exportToHTML';
import { ExportToPDF } from './export/exportToPDF';
import { ExportToPython } from './export/exportToPython';
import { ExportUtil } from './export/exportUtil';
import { ExportFormat, INbConvertExport, IExportDialog, IFileConverter, IExport } from './export/types';
import { PlotViewer } from './plotting/plotViewer';
import { PlotViewerProvider } from './plotting/plotViewerProvider';
import { StatusProvider } from './statusProvider';
import { ThemeFinder } from './themeFinder';
import { ICodeCssGenerator, IDataScience, IDataScienceCommandListener, IDataScienceErrorHandler, IDebugLocationTracker, IPlotViewer, IPlotViewerProvider, IStatusProvider, IThemeFinder } from './types';
import { NotebookWatcher } from './variablesView/notebookWatcher';
import { INotebookWatcher, IVariableViewProvider } from './variablesView/types';
import { VariableViewActivationService } from './variablesView/variableViewActivationService';
import { VariableViewProvider } from './variablesView/variableViewProvider';
import { ExtensionRecommendationService } from './extensionRecommendation';
import { IDebuggingManager } from '../debugger/types';
import { DebuggingManager } from '../debugger/jupyter/debuggingManager';
import { ExportToPythonPlain } from './export/exportToPythonPlain';
import { KernelProgressReporter } from './progress/kernelProgressReporter';
import { PreReleaseChecker } from './prereleaseChecker';
import { ProgressReporter } from './progress/progressReporter';
import { LogReplayService } from '../../intellisense/logReplayService';

// README: Did you make sure "dataScienceIocContainer.ts" has also been updated appropriately?

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingletonInstance<number>(DataScienceStartupTime, Date.now());

    // This condition is temporary.
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
