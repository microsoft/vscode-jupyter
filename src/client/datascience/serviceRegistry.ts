// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as vscode from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { IPythonExtensionChecker } from '../api/types';
import { JVSC_EXTENSION_ID, UseCustomEditorApi, UseVSCodeNotebookEditorApi } from '../common/constants';
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
import { DataScienceStartupTime, Identifiers, OurNotebookProvider, VSCodeNotebookProvider } from './constants';
import { DataViewer } from './data-viewing/dataViewer';
import { DataViewerDependencyService } from './data-viewing/dataViewerDependencyService';
import { DataViewerFactory } from './data-viewing/dataViewerFactory';
import { JupyterVariableDataProvider } from './data-viewing/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from './data-viewing/jupyterVariableDataProviderFactory';
import { IDataViewer, IDataViewerFactory } from './data-viewing/types';
import { DataScience } from './datascience';
import { DataScienceSurveyBannerLogger } from './dataScienceSurveyBanner';
import { DebugLocationTrackerFactory } from './debugLocationTrackerFactory';
import { CellHashProvider } from './editor-integration/cellhashprovider';
import { CodeLensFactory } from './editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from './editor-integration/codelensprovider';
import { CodeWatcher } from './editor-integration/codewatcher';
import { Decorator } from './editor-integration/decorator';
import { HoverProvider } from './editor-integration/hoverProvider';
import { DataScienceErrorHandler } from './errorHandler/errorHandler';
import { ExportBase } from './export/exportBase';
import { ExportDialog } from './export/exportDialog';
import { ExportFileOpener } from './export/exportFileOpener';
import { ExportInterpreterFinder } from './export/exportInterpreterFinder';
import { ExportManager } from './export/exportManager';
import { ExportToHTML } from './export/exportToHTML';
import { ExportToPDF } from './export/exportToPDF';
import { ExportToPython } from './export/exportToPython';
import { ExportUtil } from './export/exportUtil';
import { ExportFormat, IExport, IExportDialog, IExportManager } from './export/types';
import { DebugListener } from './interactive-common/debugListener';
import { IntellisenseProvider } from './interactive-common/intellisense/intellisenseProvider';
import { LinkProvider } from './interactive-common/linkProvider';
import { NotebookProvider } from './interactive-common/notebookProvider';
import { NotebookServerProvider } from './interactive-common/notebookServerProvider';
import { NotebookUsageTracker } from './interactive-common/notebookUsageTracker';
import { ShowPlotListener } from './interactive-common/showPlotListener';
import { DigestStorage } from './interactive-ipynb/digestStorage';
import { NativeEditor } from './interactive-ipynb/nativeEditor';
import { NativeEditorCommandListener } from './interactive-ipynb/nativeEditorCommandListener';
import { NativeEditorRunByLineListener } from './interactive-ipynb/nativeEditorRunByLineListener';
import { NativeEditorSynchronizer } from './interactive-ipynb/nativeEditorSynchronizer';
import { NativeEditorViewTracker } from './interactive-ipynb/nativeEditorViewTracker';
import { SystemPseudoRandomNumberGenerator } from './interactive-ipynb/randomBytes';
import { TrustCommandHandler } from './interactive-ipynb/trustCommandHandler';
import { TrustService } from './interactive-ipynb/trustService';
import { InteractiveWindow } from './interactive-window/interactiveWindow';
import { InteractiveWindowCommandListener } from './interactive-window/interactiveWindowCommandListener';
import { InteractiveWindowProvider } from './interactive-window/interactiveWindowProvider';
import { IPyWidgetMessageDispatcherFactory } from './ipywidgets/ipyWidgetMessageDispatcherFactory';
import { WebviewIPyWidgetCoordinator } from './ipywidgets/webviewIPyWidgetCoordinator';
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
import { JupyterDebugger } from './jupyter/jupyterDebugger';
import { JupyterExecutionFactory } from './jupyter/jupyterExecutionFactory';
import { JupyterExporter } from './jupyter/jupyterExporter';
import { JupyterImporter } from './jupyter/jupyterImporter';
import { JupyterNotebookProvider } from './jupyter/jupyterNotebookProvider';
import { JupyterPasswordConnect } from './jupyter/jupyterPasswordConnect';
import { JupyterServerWrapper } from './jupyter/jupyterServerWrapper';
import { JupyterSessionManagerFactory } from './jupyter/jupyterSessionManagerFactory';
import { JupyterVariables } from './jupyter/jupyterVariables';
import { isLocalLaunch } from './jupyter/kernels/helpers';
import { KernelDependencyService } from './jupyter/kernels/kernelDependencyService';
import { KernelSelectionProvider } from './jupyter/kernels/kernelSelections';
import { KernelSelector } from './jupyter/kernels/kernelSelector';
import { KernelService } from './jupyter/kernels/kernelService';
import { KernelSwitcher } from './jupyter/kernels/kernelSwitcher';
import { KernelVariables } from './jupyter/kernelVariables';
import { NotebookStarter } from './jupyter/notebookStarter';
import { ServerPreload } from './jupyter/serverPreload';
import { JupyterServerSelector } from './jupyter/serverSelector';
import { JupyterServerUriStorage } from './jupyter/serverUriStorage';
import { JupyterDebugService } from './jupyterDebugService';
import { JupyterUriProviderRegistration } from './jupyterUriProviderRegistration';
import { KernelDaemonPool } from './kernel-launcher/kernelDaemonPool';
import { KernelDaemonPreWarmer } from './kernel-launcher/kernelDaemonPreWarmer';
import { KernelEnvironmentVariablesService } from './kernel-launcher/kernelEnvVarsService';
import { KernelFinder } from './kernel-launcher/kernelFinder';
import { KernelLauncher } from './kernel-launcher/kernelLauncher';
import { IKernelFinder, IKernelLauncher } from './kernel-launcher/types';
import { MultiplexingDebugService } from './multiplexingDebugService';
import { NotebookEditorCompatibilitySupport } from './notebook/notebookEditorCompatibilitySupport';
import { NotebookEditorProvider } from './notebook/notebookEditorProvider';
import { NotebookEditorProviderWrapper } from './notebook/notebookEditorProviderWrapper';
import { registerTypes as registerNotebookTypes } from './notebook/serviceRegistry';
import { registerTypes as registerContextTypes } from './telemetry/serviceRegistry';
import { NotebookCreationTracker } from './notebookAndInteractiveTracker';
import { NotebookExtensibility } from './notebookExtensibility';
import { NotebookModelFactory } from './notebookStorage/factory';
import { NativeEditorProvider } from './notebookStorage/nativeEditorProvider';
import { NativeEditorStorage } from './notebookStorage/nativeEditorStorage';
import { NotebookModelSynchronization } from './notebookStorage/notebookModelSynchronization';
import { INotebookStorageProvider, NotebookStorageProvider } from './notebookStorage/notebookStorageProvider';
import { PreferredRemoteKernelIdProvider } from './notebookStorage/preferredRemoteKernelIdProvider';
import { INotebookModelFactory } from './notebookStorage/types';
import { PlotViewer } from './plotting/plotViewer';
import { PlotViewerProvider } from './plotting/plotViewerProvider';
import { PreWarmActivatedJupyterEnvironmentVariables } from './preWarmVariables';
import { ProgressReporter } from './progress/progressReporter';
import { RawNotebookProviderWrapper } from './raw-kernel/rawNotebookProviderWrapper';
import { RawNotebookSupportedService } from './raw-kernel/rawNotebookSupportedService';
import { StatusProvider } from './statusProvider';
import { ThemeFinder } from './themeFinder';
import {
    ICellHashListener,
    ICellHashProvider,
    ICodeCssGenerator,
    ICodeLensFactory,
    ICodeWatcher,
    IDataScience,
    IDataScienceCodeLensProvider,
    IDataScienceCommandListener,
    IDataScienceErrorHandler,
    IDebugLocationTracker,
    IDigestStorage,
    IHoverProvider,
    IInteractiveWindow,
    IInteractiveWindowListener,
    IInteractiveWindowProvider,
    IJupyterCommandFactory,
    IJupyterDebugger,
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
    INbConvertExportToPythonService,
    INbConvertInterpreterDependencyChecker,
    INotebookCreationTracker,
    INotebookEditor,
    INotebookEditorProvider,
    INotebookExecutionLogger,
    INotebookExporter,
    INotebookExtensibility,
    INotebookImporter,
    INotebookModelSynchronization,
    INotebookProvider,
    INotebookServer,
    INotebookStorage,
    IPlotViewer,
    IPlotViewerProvider,
    IRawNotebookProvider,
    IRawNotebookSupportedService,
    IStatusProvider,
    ISystemPseudoRandomNumberGenerator,
    IThemeFinder,
    ITrustService,
    IWebviewExtensibility
} from './types';
import { NotebookWatcher } from './variablesView/notebookWatcher';
import { INotebookWatcher, IVariableViewProvider } from './variablesView/types';
import { VariableViewActivationService } from './variablesView/variableViewActivationService';
import { VariableViewProvider } from './variablesView/variableViewProvider';
import { WebviewExtensibility } from './webviewExtensibility';
import { IApplicationEnvironment } from '../common/application/types';

// README: Did you make sure "dataScienceIocContainer.ts" has also been updated appropriately?

// eslint-disable-next-line
export function registerTypes(serviceManager: IServiceManager, inNotebookApiExperiment: boolean) {
    const isVSCInsiders = serviceManager.get<IApplicationEnvironment>(IApplicationEnvironment).channel === 'insiders';
    const useVSCodeNotebookAPI = inNotebookApiExperiment;
    const usingCustomEditor = !useVSCodeNotebookAPI && !isVSCInsiders;
    serviceManager.addSingletonInstance<boolean>(UseCustomEditorApi, usingCustomEditor);
    serviceManager.addSingletonInstance<boolean>(UseVSCodeNotebookEditorApi, useVSCodeNotebookAPI);
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
        setSharedProperty('rawKernelSupported', rawService.supported() ? 'true' : 'false');
    }

    // This condition is temporary.
    serviceManager.addSingleton<INotebookEditorProvider>(VSCodeNotebookProvider, NotebookEditorProvider);
    serviceManager.addSingleton<INotebookEditorProvider>(OurNotebookProvider, NativeEditorProvider);
    serviceManager.addSingleton<INotebookEditorProvider>(INotebookEditorProvider, NotebookEditorProviderWrapper);
    serviceManager.add<IExtensionSingleActivationService>(IExtensionSingleActivationService, NotebookEditorCompatibilitySupport);
    serviceManager.add<NotebookEditorCompatibilitySupport>(NotebookEditorCompatibilitySupport, NotebookEditorCompatibilitySupport);
    if (!useVSCodeNotebookAPI) {
        serviceManager.add<INotebookEditor>(INotebookEditor, NativeEditor);
        serviceManager.addSingleton<NativeEditorSynchronizer>(NativeEditorSynchronizer, NativeEditorSynchronizer);
    }

    serviceManager.add<ICellHashProvider>(ICellHashProvider, CellHashProvider, undefined, [INotebookExecutionLogger]);
    serviceManager.addSingleton<INotebookModelFactory>(INotebookModelFactory, NotebookModelFactory);
    serviceManager.addSingleton<INotebookModelSynchronization>(INotebookModelSynchronization, NotebookModelSynchronization);
    serviceManager.addSingleton<IHoverProvider>(IHoverProvider, HoverProvider);
    serviceManager.addBinding(IHoverProvider, INotebookExecutionLogger);
    serviceManager.add<ICodeWatcher>(ICodeWatcher, CodeWatcher);
    serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
    serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
    serviceManager.add<IInteractiveWindow>(IInteractiveWindow, InteractiveWindow);
    serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, DebugListener);
    serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, IntellisenseProvider);
    serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, LinkProvider);
    serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, ShowPlotListener);
    serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, WebviewIPyWidgetCoordinator);
    serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, NativeEditorRunByLineListener);
    serviceManager.add<IJupyterCommandFactory>(IJupyterCommandFactory, JupyterCommandFactory);
    serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);
    serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
    serviceManager.add<INotebookServer>(INotebookServer, JupyterServerWrapper);
    serviceManager.addSingleton<INotebookStorage>(INotebookStorage, NativeEditorStorage);
    serviceManager.addSingleton<INotebookStorageProvider>(INotebookStorageProvider, NotebookStorageProvider);
    serviceManager.addSingleton<PreferredRemoteKernelIdProvider>(PreferredRemoteKernelIdProvider, PreferredRemoteKernelIdProvider);
    serviceManager.addSingleton<IRawNotebookProvider>(IRawNotebookProvider, RawNotebookProviderWrapper);
    serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);
    serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);
    serviceManager.addSingleton<IKernelLauncher>(IKernelLauncher, KernelLauncher);
    serviceManager.addSingleton<KernelEnvironmentVariablesService>(KernelEnvironmentVariablesService, KernelEnvironmentVariablesService);
    serviceManager.addSingleton<IKernelFinder>(IKernelFinder, KernelFinder);
    serviceManager.addSingleton<CellOutputMimeTypeTracker>(CellOutputMimeTypeTracker, CellOutputMimeTypeTracker, undefined, [IExtensionSingleActivationService, INotebookExecutionLogger]);
    serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
    serviceManager.addSingleton<DataViewerDependencyService>(DataViewerDependencyService, DataViewerDependencyService);
    serviceManager.addSingleton<ICodeCssGenerator>(ICodeCssGenerator, CodeCssGenerator);
    serviceManager.addSingleton<ICodeLensFactory>(ICodeLensFactory, CodeLensFactory, undefined, [IInteractiveWindowListener]);
    serviceManager.addSingleton<IDataScience>(IDataScience, DataScience);
    serviceManager.addSingleton<IDataScienceCodeLensProvider>(IDataScienceCodeLensProvider, DataScienceCodeLensProvider);
    serviceManager.addSingleton<IVariableViewProvider>(IVariableViewProvider, VariableViewProvider);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, InteractiveWindowCommandListener);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, NativeEditorCommandListener);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, GitHubIssueCommandListener);
    serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
    serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Activation);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, Decorator);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, JupyterInterpreterSelectionCommand);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, PreWarmActivatedJupyterEnvironmentVariables);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, ServerPreload);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, NativeEditorViewTracker);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, NotebookUsageTracker);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, TrustCommandHandler);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, MigrateJupyterInterpreterStateService);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, VariableViewActivationService);
    serviceManager.addSingleton<IInteractiveWindowListener>(IInteractiveWindowListener, DataScienceSurveyBannerLogger);
    serviceManager.addSingleton<IInteractiveWindowProvider>(IInteractiveWindowProvider, InteractiveWindowProvider);
    serviceManager.addSingleton<IJupyterDebugger>(IJupyterDebugger, JupyterDebugger, undefined, [ICellHashListener]);
    serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, JupyterExecutionFactory);
    serviceManager.addSingleton<IJupyterPasswordConnect>(IJupyterPasswordConnect, JupyterPasswordConnect);
    serviceManager.addSingleton<IJupyterSessionManagerFactory>(IJupyterSessionManagerFactory, JupyterSessionManagerFactory);
    serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, DebuggerVariableRegistration);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, JupyterVariables, Identifiers.ALL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, KernelVariables, Identifiers.KERNEL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, DebuggerVariables, Identifiers.DEBUGGER_VARIABLES);
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
    serviceManager.addSingleton<KernelSelectionProvider>(KernelSelectionProvider, KernelSelectionProvider);
    serviceManager.addSingleton<KernelSelector>(KernelSelector, KernelSelector);
    serviceManager.addSingleton<KernelService>(KernelService, KernelService);
    serviceManager.addSingleton<KernelSwitcher>(KernelSwitcher, KernelSwitcher);
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
    serviceManager.addSingleton<IExportManager>(IExportManager, ExportManager);
    serviceManager.addSingleton<ExportInterpreterFinder>(ExportInterpreterFinder, ExportInterpreterFinder);
    serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);
    serviceManager.addSingleton<IExport>(IExport, ExportToPDF, ExportFormat.pdf);
    serviceManager.addSingleton<IExport>(IExport, ExportToHTML, ExportFormat.html);
    serviceManager.addSingleton<IExport>(IExport, ExportToPython, ExportFormat.python);
    serviceManager.addSingleton<IExport>(IExport, ExportBase, 'Export Base');
    serviceManager.addSingleton<ExportUtil>(ExportUtil, ExportUtil);
    serviceManager.addSingleton<ExportCommands>(ExportCommands, ExportCommands);
    serviceManager.addSingleton<IExportDialog>(IExportDialog, ExportDialog);
    serviceManager.addSingleton<IJupyterUriProviderRegistration>(IJupyterUriProviderRegistration, JupyterUriProviderRegistration);
    serviceManager.addSingleton<ISystemPseudoRandomNumberGenerator>(ISystemPseudoRandomNumberGenerator, SystemPseudoRandomNumberGenerator);
    serviceManager.addSingleton<IDigestStorage>(IDigestStorage, DigestStorage);
    serviceManager.addSingleton<ITrustService>(ITrustService, TrustService);
    serviceManager.addSingleton<IFileSystemPathUtils>(IFileSystemPathUtils, FileSystemPathUtils);
    serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
    serviceManager.addSingleton<INotebookExtensibility>(INotebookExtensibility, NotebookExtensibility);
    serviceManager.addBinding(INotebookExtensibility, INotebookExecutionLogger);
    serviceManager.addSingleton<IWebviewExtensibility>(IWebviewExtensibility, WebviewExtensibility);
    serviceManager.addSingleton<INotebookWatcher>(INotebookWatcher, NotebookWatcher);

    registerNotebookTypes(serviceManager);
    registerContextTypes(serviceManager);
}
