// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IServiceManager } from '../platform/ioc/types';
import { CommandRegistry } from './commands/commandRegistry';
import { registerTypes as registerApiTypes } from './api/serviceRegistry';
import { registerTypes as commonRegisterTypes } from './common/serviceRegistry';
import { registerLoggerTypes } from './logging/serviceRegistry';
import { registerTypes as commonRegisterTerminalTypes } from './terminals/serviceRegistry';
import { registerTypes as activationRegisterTypes } from './activation/serviceRegistry';
import { DataScienceStartupTime } from './common/constants';
import { LogReplayService } from '../intellisense/logReplayService';
import { Activation } from '../kernels/activation';
import { CodeCssGenerator } from '../webviews/extension-side/codeCssGenerator';
import { DataViewer } from '../webviews/extension-side/dataviewer/dataViewer';
import { DataViewerDependencyService } from '../webviews/extension-side/dataviewer/dataViewerDependencyService';
import { DataViewerFactory } from '../webviews/extension-side/dataviewer/dataViewerFactory';
import { IDataViewer, IDataViewerFactory } from '../webviews/extension-side/dataviewer/types';
import { PlotViewer } from '../webviews/extension-side/plotting/plotViewer';
import { PlotViewerProvider } from '../webviews/extension-side/plotting/plotViewerProvider';
import { IPlotViewer, IPlotViewerProvider } from '../webviews/extension-side/plotting/types';
import { ThemeFinder } from '../webviews/extension-side/themeFinder';
import { ICodeCssGenerator, IThemeFinder } from '../webviews/extension-side/types';
import { NotebookWatcher } from '../webviews/extension-side/variablesView/notebookWatcher';
import { INotebookWatcher } from '../webviews/extension-side/variablesView/types';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from './activation/types';
import { ExtensionRecommendationService } from './common/extensionRecommendation';
import { GlobalActivation } from './common/globalActivation';
import { FileSystemPathUtils } from './common/platform/fs-paths';
import { IFileSystemPathUtils } from './common/platform/types';
import { PreReleaseChecker } from './common/prereleaseChecker';
import { IDataScienceCommandListener } from './common/types';
import { DebugLocationTrackerFactory } from './debugger/debugLocationTrackerFactory';
import { DebuggingManager } from './debugger/jupyter/debuggingManager';
import { IDebugLocationTracker, IDebuggingManager } from './debugger/types';
import { DataScienceErrorHandler } from './errors/errorHandler';
import { IDataScienceErrorHandler } from './errors/types';
import { ExportBase } from './export/exportBase';
import { ExportDialog } from './export/exportDialog';
import { ExportFileOpener } from './export/exportFileOpener';
import { ExportInterpreterFinder } from './export/exportInterpreterFinder';
import { ExportToHTML } from './export/exportToHTML';
import { ExportToPDF } from './export/exportToPDF';
import { ExportToPython } from './export/exportToPython';
import { ExportToPythonPlain } from './export/exportToPythonPlain';
import { ExportUtil } from './export/exportUtil';
import { FileConverter } from './export/fileConverter';
import { IFileConverter, INbConvertExport, ExportFormat, IExport, IExportDialog } from './export/types';
import { GitHubIssueCommandListener } from './logging/gitHubIssueCommandListener';
import { KernelProgressReporter } from './progress/kernelProgressReporter';
import { ProgressReporter } from './progress/progressReporter';
import { StatusProvider } from './progress/statusProvider';
import { IStatusProvider } from './progress/types';

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    // Logging should be done first so we get logging going asap
    registerLoggerTypes(serviceManager);
    serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
    activationRegisterTypes(serviceManager);
    registerApiTypes(serviceManager);
    commonRegisterTypes(serviceManager);
    commonRegisterTerminalTypes(serviceManager);

    // Root platform types
    serviceManager.addSingletonInstance<number>(DataScienceStartupTime, Date.now());
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);
    serviceManager.addSingleton<DataViewerDependencyService>(DataViewerDependencyService, DataViewerDependencyService);
    serviceManager.addSingleton<ICodeCssGenerator>(ICodeCssGenerator, CodeCssGenerator);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, GlobalActivation);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, GitHubIssueCommandListener);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Activation);
    if (isDevMode) {
        serviceManager.addSingleton<IExtensionSingleActivationService>(
            IExtensionSingleActivationService,
            LogReplayService
        );
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
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        PreReleaseChecker
    );
}
