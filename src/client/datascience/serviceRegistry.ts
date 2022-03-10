// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as vscode from 'vscode';
import { IExtensionSingleActivationService, IExtensionSyncActivationService } from '../activation/types';
import { IPythonExtensionChecker } from '../api/types';
import { JVSC_EXTENSION_ID } from '../common/constants';
import { FileSystemPathUtils } from '../common/platform/fs-paths';
import { IFileSystemPathUtils } from '../common/platform/types';
import { IConfigurationService } from '../common/types';
import { ProtocolParser } from '../debugger/extension/helpers/protocolParser';
import { IProtocolParser } from '../debugger/extension/types';
import { IServiceManager } from '../ioc/types';
import { GitHubIssueCommandListener } from '../logging/gitHubIssueCommandListener';
import { setSharedProperty } from '../telemetry';
import { Activation } from './activation';
import { CodeCssGenerator } from './codeCssGenerator';
import { JupyterCommandLineSelectorCommand } from './commands/commandLineSelector';
import { CommandRegistry } from './commands/commandRegistry';
import { ExportCommands } from './commands/exportCommands';
import { NotebookCommands } from './commands/notebookCommands';
import { JupyterServerSelectorCommand } from './commands/serverSelector';
import { DataScienceStartupTime, Identifiers } from './constants';
import { DataViewer } from './data-viewing/dataViewer';
import { DataViewerDependencyService } from './data-viewing/dataViewerDependencyService';
import { DataViewerFactory } from './data-viewing/dataViewerFactory';
import { JupyterVariableDataProvider } from './data-viewing/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from './data-viewing/jupyterVariableDataProviderFactory';
import { IDataViewer, IDataViewerFactory } from './data-viewing/types';
import { GlobalActivation } from './datascience';
import { DebugLocationTrackerFactory } from './debugLocationTrackerFactory';
import { CodeLensFactory } from './editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from './editor-integration/codelensprovider';
import { CodeWatcher } from './editor-integration/codewatcher';
import { Decorator } from './editor-integration/decorator';
import { HoverProvider } from './editor-integration/hoverProvider';
import { DataScienceErrorHandler } from './errors/errorHandler';
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
import { MultiplexingDebugService } from './multiplexingDebugService';
import { NotebookEditorProvider } from './notebook/notebookEditorProvider';
import { registerTypes as registerNotebookTypes } from './notebook/serviceRegistry';
import { registerTypes as registerContextTypes } from './telemetry/serviceRegistry';
import { PreferredRemoteKernelIdProvider } from './notebookStorage/preferredRemoteKernelIdProvider';
import { PlotViewer } from './plotting/plotViewer';
import { PlotViewerProvider } from './plotting/plotViewerProvider';
import { StatusProvider } from './statusProvider';
import { ThemeFinder } from './themeFinder';
import {
    ICellHashListener,
    ICodeCssGenerator,
    ICodeLensFactory,
    ICodeWatcher,
    IDataScience,
    IDataScienceCodeLensProvider,
    IDataScienceCommandListener,
    IDataScienceErrorHandler,
    IDebugLocationTracker,
    IInteractiveWindowProvider,
    IJupyterCommandFactory,
    IInteractiveWindowDebugger,
    IJupyterDebugService,
    IJupyterExecution,
    IJupyterInterpreterDependencyManager,
    IJupyterNotebookProvider,
    IJupyterPasswordConnect,
    IJupyterServerProvider,
    IJupyterServerUriStorage,
    IJupyterSessionManagerFactory,
    IJupyterSubCommandExecutionService,
    IJupyterUriProviderRegistration,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    IKernelDependencyService,
    IKernelVariableRequester,
    INbConvertExportToPythonService,
    INbConvertInterpreterDependencyChecker,
    INotebookEditorProvider,
    INotebookExporter,
    INotebookImporter,
    INotebookProvider,
    INotebookServer,
    IPlotViewer,
    IPlotViewerProvider,
    IRawNotebookProvider,
    IRawNotebookSupportedService,
    IStatusProvider,
    IThemeFinder
} from './types';
import { NotebookWatcher } from './variablesView/notebookWatcher';
import { INotebookWatcher, IVariableViewProvider } from './variablesView/types';
import { VariableViewActivationService } from './variablesView/variableViewActivationService';
import { VariableViewProvider } from './variablesView/variableViewProvider';
import { IApplicationEnvironment } from '../common/application/types';
import { ExtensionRecommendationService } from './extensionRecommendation';
import { NativeInteractiveWindowCommandListener } from './interactive-window/interactiveWindowCommandListener';
import { InteractiveWindowProvider } from './interactive-window/interactiveWindowProvider';
import { IDebuggingManager } from '../debugger/types';
import { DebuggingManager } from '../debugger/jupyter/debuggingManager';
import { KernelCommandListener } from '../../kernels/kernelCommandListener';
import { CellHashProviderFactory } from './editor-integration/cellHashProviderFactory';
import { ExportToPythonPlain } from './export/exportToPythonPlain';
import { ErrorRendererCommunicationHandler } from './errors/errorRendererComms';
import { KernelProgressReporter } from './progress/kernelProgressReporter';
import { PreReleaseChecker } from './prereleaseChecker';
import { LogReplayService } from './notebook/intellisense/logReplayService';
import { InteractiveWindowDebugger } from '../../kernels/debugging/interactiveWindowDebugger';
import { JupyterDebugService } from '../../kernels/debugging/jupyterDebugService';
import { isLocalLaunch } from '../../kernels/helpers';
import { JupyterExporter } from '../../kernels/jupyter/import-export/jupyterExporter';
import { JupyterImporter } from '../../kernels/jupyter/import-export/jupyterImporter';
import { JupyterCommandFactory } from '../../kernels/jupyter/interpreter/jupyterCommand';
import { JupyterInterpreterDependencyService } from '../../kernels/jupyter/interpreter/jupyterInterpreterDependencyService';
import { JupyterInterpreterOldCacheStateStore } from '../../kernels/jupyter/interpreter/jupyterInterpreterOldCacheStateStore';
import { JupyterInterpreterSelectionCommand } from '../../kernels/jupyter/interpreter/jupyterInterpreterSelectionCommand';
import { JupyterInterpreterSelector } from '../../kernels/jupyter/interpreter/jupyterInterpreterSelector';
import { JupyterInterpreterService } from '../../kernels/jupyter/interpreter/jupyterInterpreterService';
import { MigrateJupyterInterpreterStateService, JupyterInterpreterStateStore } from '../../kernels/jupyter/interpreter/jupyterInterpreterStateStore';
import { JupyterInterpreterSubCommandExecutionService } from '../../kernels/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService';
import { NbConvertExportToPythonService } from '../../kernels/jupyter/interpreter/nbconvertExportToPythonService';
import { NbConvertInterpreterDependencyChecker } from '../../kernels/jupyter/interpreter/nbconvertInterpreterDependencyChecker';
import { CellOutputMimeTypeTracker } from '../../kernels/jupyter/jupyterCellOutputMimeTypeTracker';
import { JupyterKernelService } from '../../kernels/jupyter/jupyterKernelService';
import { JupyterCommandLineSelector } from '../../kernels/jupyter/launcher/commandLineSelector';
import { JupyterNotebookProvider } from '../../kernels/jupyter/launcher/jupyterNotebookProvider';
import { JupyterPasswordConnect } from '../../kernels/jupyter/launcher/jupyterPasswordConnect';
import { HostJupyterExecution } from '../../kernels/jupyter/launcher/liveshare/hostJupyterExecution';
import { HostJupyterServer } from '../../kernels/jupyter/launcher/liveshare/hostJupyterServer';
import { NotebookProvider } from '../../kernels/jupyter/launcher/notebookProvider';
import { NotebookServerProvider } from '../../kernels/jupyter/launcher/notebookServerProvider';
import { NotebookStarter } from '../../kernels/jupyter/launcher/notebookStarter';
import { JupyterServerUriStorage } from '../../kernels/jupyter/launcher/serverUriStorage';
import { JupyterServerSelector } from '../../kernels/jupyter/serverSelector';
import { JupyterSessionManagerFactory } from '../../kernels/jupyter/session/jupyterSessionManagerFactory';
import { KernelDependencyService } from '../../kernels/kernelDependencyService';
import { JupyterPaths } from '../../kernels/raw/finder/jupyterPaths';
import { LocalKernelFinder } from '../../kernels/raw/finder/localKernelFinder';
import { LocalKnownPathKernelSpecFinder } from '../../kernels/raw/finder/localKnownPathKernelSpecFinder';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from '../../kernels/raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder';
import { RemoteKernelFinder } from '../../kernels/raw/finder/remoteKernelFinder';
import { KernelEnvironmentVariablesService } from '../../kernels/raw/launcher/kernelEnvVarsService';
import { KernelLauncher } from '../../kernels/raw/launcher/kernelLauncher';
import { HostRawNotebookProvider } from '../../kernels/raw/session/hostRawNotebookProvider';
import { RawNotebookSupportedService } from '../../kernels/raw/session/rawNotebookSupportedService';
import { IKernelLauncher, ILocalKernelFinder, IRemoteKernelFinder } from '../../kernels/raw/types';
import { DebuggerVariableRegistration } from '../../kernels/variables/debuggerVariableRegistration';
import { DebuggerVariables } from '../../kernels/variables/debuggerVariables';
import { JupyterVariables } from '../../kernels/variables/jupyterVariables';
import { KernelVariables } from '../../kernels/variables/kernelVariables';
import { PreWarmActivatedJupyterEnvironmentVariables } from '../../kernels/variables/preWarmVariables';
import { PythonVariablesRequester } from '../../kernels/variables/pythonVariableRequester';
import { NotebookUsageTracker } from './interactive-common/notebookUsageTracker';
import { NativeEditorCommandListener } from './interactive-ipynb/nativeEditorCommandListener';
import { ProgressReporter } from './progress/progressReporter';
import { IPyWidgetMessageDispatcherFactory } from '../../kernels/ipywidgets-message-coordination/ipyWidgetMessageDispatcherFactory';
import { NotebookIPyWidgetCoordinator } from '../../kernels/ipywidgets-message-coordination/notebookIPyWidgetCoordinator';
import { JupyterUriProviderRegistration } from '../../kernels/jupyter/jupyterUriProviderRegistration';

// README: Did you make sure "dataScienceIocContainer.ts" has also been updated appropriately?

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager, inNotebookApiExperiment: boolean, isDevMode: boolean) {
    const isVSCInsiders = serviceManager.get<IApplicationEnvironment>(IApplicationEnvironment).channel === 'insiders';
    const useVSCodeNotebookAPI = inNotebookApiExperiment;
    serviceManager.addSingletonInstance<number>(DataScienceStartupTime, Date.now());
    serviceManager.addSingleton<IRawNotebookSupportedService>(IRawNotebookSupportedService, RawNotebookSupportedService);

    const packageJson: { engines: { vscode: string } } | undefined = vscode.extensions.getExtension(JVSC_EXTENSION_ID)?.packageJSON;
    const isInsiderVersion = packageJson?.engines?.vscode?.toLowerCase()?.endsWith('insider');
    setSharedProperty('isInsiderExtension', isVSCInsiders && isInsiderVersion ? 'true' : 'false');

    // This will ensure all subsequent telemetry will get the context of whether it is a custom/native/old notebook editor.
    // This is temporary, and once we ship native editor this needs to be removed.
    setSharedProperty('ds_notebookeditor', useVSCodeNotebookAPI ? 'native' : 'custom');
    const isLocalConnection = isLocalLaunch(serviceManager.get<IConfigurationService>(IConfigurationService));
    setSharedProperty('localOrRemoteConnection', isLocalConnection ? 'local' : 'remote');
    const isPythonExtensionInstalled = serviceManager.get<IPythonExtensionChecker>(IPythonExtensionChecker);
    setSharedProperty('isPythonExtensionInstalled', isPythonExtensionInstalled.isPythonExtensionInstalled ? 'true' : 'false');
    const rawService = serviceManager.get<IRawNotebookSupportedService>(IRawNotebookSupportedService);
    setSharedProperty('rawKernelSupported', rawService.isSupported ? 'true' : 'false');

    // This condition is temporary.
    serviceManager.addSingleton<INotebookEditorProvider>(INotebookEditorProvider, NotebookEditorProvider);
    serviceManager.addSingleton<CellHashProviderFactory>(CellHashProviderFactory, CellHashProviderFactory);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, HoverProvider);
    serviceManager.add<ICodeWatcher>(ICodeWatcher, CodeWatcher);
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.addSingleton<NotebookIPyWidgetCoordinator>(NotebookIPyWidgetCoordinator, NotebookIPyWidgetCoordinator);
    serviceManager.add<IJupyterCommandFactory>(IJupyterCommandFactory, JupyterCommandFactory);
    serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);
    serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
    serviceManager.add<INotebookServer>(INotebookServer, HostJupyterServer);
    serviceManager.addSingleton<PreferredRemoteKernelIdProvider>(PreferredRemoteKernelIdProvider, PreferredRemoteKernelIdProvider);
    serviceManager.addSingleton<IRawNotebookProvider>(IRawNotebookProvider, HostRawNotebookProvider);
    serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);
    serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);
    serviceManager.addSingleton<IKernelLauncher>(IKernelLauncher, KernelLauncher);
    serviceManager.addSingleton<KernelEnvironmentVariablesService>(KernelEnvironmentVariablesService, KernelEnvironmentVariablesService);
    serviceManager.addSingleton<ILocalKernelFinder>(ILocalKernelFinder, LocalKernelFinder);
    serviceManager.addSingleton<JupyterPaths>(JupyterPaths, JupyterPaths);
    serviceManager.addSingleton<LocalKnownPathKernelSpecFinder>(LocalKnownPathKernelSpecFinder, LocalKnownPathKernelSpecFinder);
    serviceManager.addSingleton<LocalPythonAndRelatedNonPythonKernelSpecFinder>(LocalPythonAndRelatedNonPythonKernelSpecFinder, LocalPythonAndRelatedNonPythonKernelSpecFinder);
    serviceManager.addSingleton<IRemoteKernelFinder>(IRemoteKernelFinder, RemoteKernelFinder);
    serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
    serviceManager.addSingleton<DataViewerDependencyService>(DataViewerDependencyService, DataViewerDependencyService);
    serviceManager.addSingleton<ICodeCssGenerator>(ICodeCssGenerator, CodeCssGenerator);
    serviceManager.addSingleton<ICodeLensFactory>(ICodeLensFactory, CodeLensFactory);
    serviceManager.addSingleton<IDataScience>(IDataScience, GlobalActivation);
    serviceManager.addSingleton<IDataScienceCodeLensProvider>(IDataScienceCodeLensProvider, DataScienceCodeLensProvider);
    serviceManager.addSingleton<IVariableViewProvider>(IVariableViewProvider, VariableViewProvider);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, NativeEditorCommandListener);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, GitHubIssueCommandListener);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Activation);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, CellOutputMimeTypeTracker);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Decorator);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, JupyterInterpreterSelectionCommand);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, PreWarmActivatedJupyterEnvironmentVariables);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, NotebookUsageTracker);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, MigrateJupyterInterpreterStateService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, VariableViewActivationService);
    if (isDevMode) {
        serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, LogReplayService);
    }
    serviceManager.addSingleton<IInteractiveWindowProvider>(IInteractiveWindowProvider, InteractiveWindowProvider);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, NativeInteractiveWindowCommandListener);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, KernelCommandListener);
    serviceManager.addSingleton<IInteractiveWindowDebugger>(IInteractiveWindowDebugger, InteractiveWindowDebugger, undefined, [ICellHashListener]);
    serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, HostJupyterExecution);
    serviceManager.addSingleton<IJupyterPasswordConnect>(IJupyterPasswordConnect, JupyterPasswordConnect);
    serviceManager.addSingleton<IJupyterSessionManagerFactory>(IJupyterSessionManagerFactory, JupyterSessionManagerFactory);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, DebuggerVariableRegistration);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, JupyterVariables, Identifiers.ALL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, KernelVariables, Identifiers.KERNEL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, DebuggerVariables, Identifiers.DEBUGGER_VARIABLES);
    serviceManager.addSingleton<IKernelVariableRequester>(IKernelVariableRequester, PythonVariablesRequester, Identifiers.PYTHON_VARIABLES_REQUESTER);
    serviceManager.addSingleton<IPlotViewerProvider>(IPlotViewerProvider, PlotViewerProvider);
    serviceManager.addSingleton<IStatusProvider>(IStatusProvider, StatusProvider);
    serviceManager.addSingleton<IThemeFinder>(IThemeFinder, ThemeFinder);
    serviceManager.addSingleton<JupyterCommandLineSelector>(JupyterCommandLineSelector, JupyterCommandLineSelector);
    serviceManager.addSingleton<JupyterCommandLineSelectorCommand>(JupyterCommandLineSelectorCommand, JupyterCommandLineSelectorCommand);
    serviceManager.addSingleton<JupyterInterpreterDependencyService>(JupyterInterpreterDependencyService, JupyterInterpreterDependencyService);
    serviceManager.addSingleton<INbConvertInterpreterDependencyChecker>(INbConvertInterpreterDependencyChecker, NbConvertInterpreterDependencyChecker);
    serviceManager.addSingleton<INbConvertExportToPythonService>(INbConvertExportToPythonService, NbConvertExportToPythonService);
    serviceManager.addSingleton<JupyterInterpreterOldCacheStateStore>(JupyterInterpreterOldCacheStateStore, JupyterInterpreterOldCacheStateStore);
    serviceManager.addSingleton<JupyterInterpreterSelector>(JupyterInterpreterSelector, JupyterInterpreterSelector);
    serviceManager.addSingleton<JupyterInterpreterService>(JupyterInterpreterService, JupyterInterpreterService);
    serviceManager.addSingleton<JupyterInterpreterStateStore>(JupyterInterpreterStateStore, JupyterInterpreterStateStore);
    serviceManager.addSingleton<JupyterServerSelector>(JupyterServerSelector, JupyterServerSelector);
    serviceManager.addSingleton<JupyterServerSelectorCommand>(JupyterServerSelectorCommand, JupyterServerSelectorCommand);
    serviceManager.addSingleton<JupyterKernelService>(JupyterKernelService, JupyterKernelService);
    serviceManager.addSingleton<NotebookCommands>(NotebookCommands, NotebookCommands);
    serviceManager.addSingleton<NotebookStarter>(NotebookStarter, NotebookStarter);
    serviceManager.addSingleton<ProgressReporter>(ProgressReporter, ProgressReporter);
    serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
    serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, NotebookServerProvider);
    serviceManager.addSingleton<IPyWidgetMessageDispatcherFactory>(IPyWidgetMessageDispatcherFactory, IPyWidgetMessageDispatcherFactory);
    serviceManager.addSingleton<IJupyterInterpreterDependencyManager>(IJupyterInterpreterDependencyManager, JupyterInterpreterSubCommandExecutionService);
    serviceManager.addSingleton<IJupyterSubCommandExecutionService>(IJupyterSubCommandExecutionService, JupyterInterpreterSubCommandExecutionService);
    serviceManager.addSingleton<IKernelDependencyService>(IKernelDependencyService, KernelDependencyService);
    serviceManager.add<IProtocolParser>(IProtocolParser, ProtocolParser);
    serviceManager.addSingleton<IJupyterDebugService>(IJupyterDebugService, MultiplexingDebugService, Identifiers.MULTIPLEXING_DEBUGSERVICE);
    serviceManager.addSingleton<IJupyterDebugService>(IJupyterDebugService, JupyterDebugService, Identifiers.RUN_BY_LINE_DEBUGSERVICE);
    serviceManager.add<IJupyterVariableDataProvider>(IJupyterVariableDataProvider, JupyterVariableDataProvider);
    serviceManager.addSingleton<IJupyterVariableDataProviderFactory>(IJupyterVariableDataProviderFactory, JupyterVariableDataProviderFactory);
    serviceManager.addSingleton<IFileConverter>(IFileConverter, FileConverter);
    serviceManager.addSingleton<ExportInterpreterFinder>(ExportInterpreterFinder, ExportInterpreterFinder);
    serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPDF, ExportFormat.pdf);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToHTML, ExportFormat.html);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportToPython, ExportFormat.python);
    serviceManager.addSingleton<INbConvertExport>(INbConvertExport, ExportBase, 'Export Base');
    serviceManager.addSingleton<IExport>(IExport, ExportToPythonPlain, ExportFormat.python);
    serviceManager.addSingleton<ExportUtil>(ExportUtil, ExportUtil);
    serviceManager.addSingleton<ExportCommands>(ExportCommands, ExportCommands);
    serviceManager.addSingleton<IExportDialog>(IExportDialog, ExportDialog);
    serviceManager.addSingleton<IJupyterUriProviderRegistration>(IJupyterUriProviderRegistration, JupyterUriProviderRegistration);
    serviceManager.addSingleton<IFileSystemPathUtils>(IFileSystemPathUtils, FileSystemPathUtils);
    serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
    serviceManager.addSingleton<INotebookWatcher>(INotebookWatcher, NotebookWatcher);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, ExtensionRecommendationService);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, ErrorRendererCommunicationHandler);
    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelProgressReporter);
    serviceManager.addSingleton<IDebuggingManager>(IDebuggingManager, DebuggingManager, undefined, [IExtensionSingleActivationService]);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, PreReleaseChecker);

    registerNotebookTypes(serviceManager);
    registerContextTypes(serviceManager);
}
