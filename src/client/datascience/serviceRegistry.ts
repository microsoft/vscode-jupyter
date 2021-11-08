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
import { DataScience } from './datascience';
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
import { NotebookProvider } from './interactive-common/notebookProvider';
import { NotebookServerProvider } from './interactive-common/notebookServerProvider';
import { NotebookUsageTracker } from './interactive-common/notebookUsageTracker';
import { NativeEditorCommandListener } from './interactive-ipynb/nativeEditorCommandListener';
import { IPyWidgetMessageDispatcherFactory } from './ipywidgets/ipyWidgetMessageDispatcherFactory';
import { JupyterCommandLineSelector } from './jupyter/commandLineSelector';
import { DebuggerVariableRegistration } from './jupyter/debuggerVariableRegistration';
import { DebuggerVariables } from './jupyter/debuggerVariables';
import { JupyterCommandFactory } from './jupyter/interpreter/jupyterCommand';
import { JupyterInterpreterDependencyService } from './jupyter/interpreter/jupyterInterpreterDependencyService';
import { JupyterInterpreterOldCacheStateStore } from './jupyter/interpreter/jupyterInterpreterOldCacheStateStore';
import { JupyterInterpreterSelectionCommand } from './jupyter/interpreter/jupyterInterpreterSelectionCommand';
import { JupyterInterpreterSelector } from './jupyter/interpreter/jupyterInterpreterSelector';
import { JupyterInterpreterService } from './jupyter/interpreter/jupyterInterpreterService';
import { JupyterInterpreterStateStore, MigrateJupyterInterpreterStateService } from './jupyter/interpreter/jupyterInterpreterStateStore';
import { JupyterInterpreterSubCommandExecutionService } from './jupyter/interpreter/jupyterInterpreterSubCommandExecutionService';
import { NbConvertExportToPythonService } from './jupyter/interpreter/nbconvertExportToPythonService';
import { NbConvertInterpreterDependencyChecker } from './jupyter/interpreter/nbconvertInterpreterDependencyChecker';
import { CellOutputMimeTypeTracker } from './jupyter/jupyterCellOutputMimeTypeTracker';
import { InteractiveWindowDebugger } from './jupyter/interactiveWindowDebugger';
import { JupyterExporter } from './jupyter/jupyterExporter';
import { JupyterImporter } from './jupyter/jupyterImporter';
import { JupyterNotebookProvider } from './jupyter/jupyterNotebookProvider';
import { JupyterPasswordConnect } from './jupyter/jupyterPasswordConnect';
import { JupyterSessionManagerFactory } from './jupyter/jupyterSessionManagerFactory';
import { JupyterVariables } from './jupyter/jupyterVariables';
import { isLocalLaunch } from './jupyter/kernels/helpers';
import { KernelDependencyService } from './jupyter/kernels/kernelDependencyService';
import { JupyterKernelService } from './jupyter/kernels/jupyterKernelService';
import { KernelVariables } from './jupyter/kernelVariables';
import { NotebookStarter } from './jupyter/notebookStarter';
import { JupyterServerSelector } from './jupyter/serverSelector';
import { JupyterServerUriStorage } from './jupyter/serverUriStorage';
import { JupyterDebugService } from './jupyterDebugService';
import { JupyterUriProviderRegistration } from './jupyterUriProviderRegistration';
import { KernelDaemonPool } from './kernel-launcher/kernelDaemonPool';
import { KernelDaemonPreWarmer } from './kernel-launcher/kernelDaemonPreWarmer';
import { KernelEnvironmentVariablesService } from './kernel-launcher/kernelEnvVarsService';
import { LocalKernelFinder } from './kernel-launcher/localKernelFinder';
import { KernelLauncher } from './kernel-launcher/kernelLauncher';
import { ILocalKernelFinder, IKernelLauncher, IRemoteKernelFinder } from './kernel-launcher/types';
import { MultiplexingDebugService } from './multiplexingDebugService';
import { NotebookEditorProvider } from './notebook/notebookEditorProvider';
import { registerTypes as registerNotebookTypes } from './notebook/serviceRegistry';
import { registerTypes as registerContextTypes } from './telemetry/serviceRegistry';
import { NotebookCreationTracker } from './notebookAndInteractiveTracker';
import { PreferredRemoteKernelIdProvider } from './notebookStorage/preferredRemoteKernelIdProvider';
import { PlotViewer } from './plotting/plotViewer';
import { PlotViewerProvider } from './plotting/plotViewerProvider';
import { PreWarmActivatedJupyterEnvironmentVariables } from './preWarmVariables';
import { ProgressReporter } from './progress/progressReporter';
import { RawNotebookSupportedService } from './raw-kernel/rawNotebookSupportedService';
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
    INotebookCreationTracker,
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
import { RemoteKernelFinder } from './kernel-launcher/remoteKernelFinder';
import { IApplicationEnvironment } from '../common/application/types';
import { NotebookIPyWidgetCoordinator } from './ipywidgets/notebookIPyWidgetCoordinator';
import { ExtensionRecommendationService } from './extensionRecommendation';
import { PythonVariablesRequester } from './jupyter/pythonVariableRequester';
import { NativeInteractiveWindowCommandListener } from './interactive-window/interactiveWindowCommandListener';
import { InteractiveWindowProvider } from './interactive-window/interactiveWindowProvider';
import { JupyterPaths } from './kernel-launcher/jupyterPaths';
import { LocalKnownPathKernelSpecFinder } from './kernel-launcher/localKnownPathKernelSpecFinder';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from './kernel-launcher/localPythonAndRelatedNonPythonKernelSpecFinder';
import { IDebuggingManager } from '../debugger/types';
import { DebuggingManager } from '../debugger/jupyter/debuggingManager';
import { HostJupyterExecution } from './jupyter/liveshare/hostJupyterExecution';
import { HostJupyterServer } from './jupyter/liveshare/hostJupyterServer';
import { HostRawNotebookProvider } from './raw-kernel/liveshare/hostRawNotebookProvider';
import { KernelCommandListener } from './jupyter/kernels/kernelCommandListener';
import { CellHashProviderFactory } from './editor-integration/cellHashProviderFactory';
import { ExportToPythonPlain } from './export/exportToPythonPlain';

// README: Did you make sure "dataScienceIocContainer.ts" has also been updated appropriately?

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager, inNotebookApiExperiment: boolean) {
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
    if (isLocalConnection) {
        const rawService = serviceManager.get<IRawNotebookSupportedService>(IRawNotebookSupportedService);
        setSharedProperty('rawKernelSupported', rawService.isSupported ? 'true' : 'false');
    }

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
    serviceManager.addSingleton<IDataScience>(IDataScience, DataScience);
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
    serviceManager.addSingleton<KernelDaemonPool>(KernelDaemonPool, KernelDaemonPool);
    serviceManager.addSingleton<IKernelDependencyService>(IKernelDependencyService, KernelDependencyService);
    serviceManager.addSingleton<INotebookCreationTracker>(INotebookCreationTracker, NotebookCreationTracker);
    serviceManager.addSingleton<KernelDaemonPreWarmer>(KernelDaemonPreWarmer, KernelDaemonPreWarmer);
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
    serviceManager.addSingleton<IDebuggingManager>(IDebuggingManager, DebuggingManager, undefined, [IExtensionSingleActivationService]);

    registerNotebookTypes(serviceManager);
    registerContextTypes(serviceManager);
}
