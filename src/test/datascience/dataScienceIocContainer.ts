// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
//tslint:disable:trailing-comma no-any
import { ReactWrapper } from 'enzyme';
import * as fs from 'fs-extra';
import * as glob from 'glob';
import { interfaces } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import { SemVer } from 'semver';
import { anyString, anything, instance, mock, reset, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import {
    CancellationTokenSource,
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    FileSystemWatcher,
    Memento,
    Uri,
    WindowState,
    WorkspaceFolder,
    WorkspaceFoldersChangeEvent
} from 'vscode';
import * as vsls from 'vsls/vscode';
import { KernelDaemonPool } from '../../client/datascience/kernel-launcher/kernelDaemonPool';

import { promisify } from 'util';
import { IExtensionSingleActivationService } from '../../client/activation/types';
import { IPythonDebuggerPathProvider } from '../../client/api/types';
import { ApplicationEnvironment } from '../../client/common/application/applicationEnvironment';
import { ApplicationShell } from '../../client/common/application/applicationShell';
import { VSCodeNotebook } from '../../client/common/application/notebook';
import {
    IApplicationEnvironment,
    IApplicationShell,
    ICommandManager,
    ICustomEditorService,
    IDebugService,
    IDocumentManager,
    ILiveShareApi,
    ILiveShareTestingApi,
    IVSCodeNotebook,
    IWebviewPanelOptions,
    IWebviewPanelProvider,
    IWorkspaceService
} from '../../client/common/application/types';
import { WebviewPanelProvider } from '../../client/common/application/webviewPanels/webviewPanelProvider';
import { WorkspaceService } from '../../client/common/application/workspace';
import { AsyncDisposableRegistry } from '../../client/common/asyncDisposableRegistry';
import { JupyterSettings } from '../../client/common/configSettings';
import {
    EXTENSION_ROOT_DIR,
    UseCustomEditorApi,
    UseProposedApi,
    UseVSCodeNotebookEditorApi
} from '../../client/common/constants';
import { CryptoUtils } from '../../client/common/crypto';
import { LocalZMQKernel } from '../../client/common/experiments/groups';
import { ExperimentsManager } from '../../client/common/experiments/manager';
import { ExperimentService } from '../../client/common/experiments/service';
import { ProductInstaller } from '../../client/common/installer/productInstaller';
import { DataScienceProductPathService } from '../../client/common/installer/productPath';
import { IProductPathService } from '../../client/common/installer/types';
import { traceError, traceInfo } from '../../client/common/logger';
import { BrowserService } from '../../client/common/net/browser';
import { HttpClient } from '../../client/common/net/httpClient';
import { IS_WINDOWS } from '../../client/common/platform/constants';
import { PathUtils } from '../../client/common/platform/pathUtils';
import { CurrentProcess } from '../../client/common/process/currentProcess';
import { BufferDecoder } from '../../client/common/process/decoder';
import { ProcessLogger } from '../../client/common/process/logger';
import { ProcessServiceFactory } from '../../client/common/process/processFactory';
import { PythonExecutionFactory } from '../../client/common/process/pythonExecutionFactory';
import {
    IBufferDecoder,
    IProcessLogger,
    IProcessServiceFactory,
    IPythonExecutionFactory
} from '../../client/common/process/types';
import {
    GLOBAL_MEMENTO,
    IAsyncDisposableRegistry,
    IBrowserService,
    IConfigurationService,
    ICryptoUtils,
    ICurrentProcess,
    IDisposable,
    IExperimentService,
    IExperimentsManager,
    IExtensionContext,
    IExtensions,
    IHttpClient,
    IInstaller,
    IJupyterSettings,
    IMemento,
    IOutputChannel,
    IPathUtils,
    IPersistentStateFactory,
    IsWindows,
    IWatchableJupyterSettings,
    Resource,
    WORKSPACE_MEMENTO
} from '../../client/common/types';
import { sleep } from '../../client/common/utils/async';
import { noop } from '../../client/common/utils/misc';
import { IMultiStepInputFactory, MultiStepInputFactory } from '../../client/common/utils/multiStepInput';
import { EnvironmentVariablesService } from '../../client/common/variables/environment';
import { EnvironmentVariablesProvider } from '../../client/common/variables/environmentVariablesProvider';
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../../client/common/variables/types';
import { CodeCssGenerator } from '../../client/datascience/codeCssGenerator';
import { JupyterCommandLineSelectorCommand } from '../../client/datascience/commands/commandLineSelector';
import { CommandRegistry } from '../../client/datascience/commands/commandRegistry';
import { ExportCommands } from '../../client/datascience/commands/exportCommands';
import { NotebookCommands } from '../../client/datascience/commands/notebookCommands';
import { JupyterServerSelectorCommand } from '../../client/datascience/commands/serverSelector';
import { DataScienceStartupTime, Identifiers, JUPYTER_OUTPUT_CHANNEL } from '../../client/datascience/constants';
import { ActiveEditorContextService } from '../../client/datascience/context/activeEditorContext';
import { DataViewer } from '../../client/datascience/data-viewing/dataViewer';
import { DataViewerDependencyService } from '../../client/datascience/data-viewing/dataViewerDependencyService';
import { DataViewerFactory } from '../../client/datascience/data-viewing/dataViewerFactory';
import { JupyterVariableDataProvider } from '../../client/datascience/data-viewing/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from '../../client/datascience/data-viewing/jupyterVariableDataProviderFactory';
import { IDataViewer, IDataViewerFactory } from '../../client/datascience/data-viewing/types';
import { DebugLocationTrackerFactory } from '../../client/datascience/debugLocationTrackerFactory';
import { CellHashProvider } from '../../client/datascience/editor-integration/cellhashprovider';
import { CodeLensFactory } from '../../client/datascience/editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from '../../client/datascience/editor-integration/codelensprovider';
import { CodeWatcher } from '../../client/datascience/editor-integration/codewatcher';
import { HoverProvider } from '../../client/datascience/editor-integration/hoverProvider';
import { DataScienceErrorHandler } from '../../client/datascience/errorHandler/errorHandler';
import { ExportBase } from '../../client/datascience/export/exportBase';
import { ExportDependencyChecker } from '../../client/datascience/export/exportDependencyChecker';
import { ExportFileOpener } from '../../client/datascience/export/exportFileOpener';
import { ExportManager } from '../../client/datascience/export/exportManager';
import { ExportManagerFilePicker } from '../../client/datascience/export/exportManagerFilePicker';
import { ExportToHTML } from '../../client/datascience/export/exportToHTML';
import { ExportToPDF } from '../../client/datascience/export/exportToPDF';
import { ExportToPython } from '../../client/datascience/export/exportToPython';
import { ExportUtil } from '../../client/datascience/export/exportUtil';
import { ExportFormat, IExport, IExportManager, IExportManagerFilePicker } from '../../client/datascience/export/types';
import { GatherListener } from '../../client/datascience/gather/gatherListener';
import { GatherLogger } from '../../client/datascience/gather/gatherLogger';
import { IntellisenseProvider } from '../../client/datascience/interactive-common/intellisense/intellisenseProvider';
import { NotebookProvider } from '../../client/datascience/interactive-common/notebookProvider';
import { NotebookServerProvider } from '../../client/datascience/interactive-common/notebookServerProvider';
import { AutoSaveService } from '../../client/datascience/interactive-ipynb/autoSaveService';
import { DigestStorage } from '../../client/datascience/interactive-ipynb/digestStorage';
import { NativeEditorCommandListener } from '../../client/datascience/interactive-ipynb/nativeEditorCommandListener';
import { NativeEditorRunByLineListener } from '../../client/datascience/interactive-ipynb/nativeEditorRunByLineListener';
import { NativeEditorSynchronizer } from '../../client/datascience/interactive-ipynb/nativeEditorSynchronizer';
import { TrustService } from '../../client/datascience/interactive-ipynb/trustService';
import { InteractiveWindowCommandListener } from '../../client/datascience/interactive-window/interactiveWindowCommandListener';
import { IPyWidgetHandler } from '../../client/datascience/ipywidgets/ipywidgetHandler';
import { IPyWidgetMessageDispatcherFactory } from '../../client/datascience/ipywidgets/ipyWidgetMessageDispatcherFactory';
import { IPyWidgetScriptSource } from '../../client/datascience/ipywidgets/ipyWidgetScriptSource';
import { JupyterCommandLineSelector } from '../../client/datascience/jupyter/commandLineSelector';
import { DebuggerVariableRegistration } from '../../client/datascience/jupyter/debuggerVariableRegistration';
import { DebuggerVariables } from '../../client/datascience/jupyter/debuggerVariables';
import { JupyterCommandFactory } from '../../client/datascience/jupyter/interpreter/jupyterCommand';
import { JupyterInterpreterDependencyService } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService';
import { JupyterInterpreterOldCacheStateStore } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterOldCacheStateStore';
import { JupyterInterpreterSelectionCommand } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterSelectionCommand';
import { JupyterInterpreterSelector } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterSelector';
import { JupyterInterpreterService } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterService';
import { JupyterInterpreterStateStore } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterStateStore';
import { JupyterInterpreterSubCommandExecutionService } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService';
import { JupyterDebugger } from '../../client/datascience/jupyter/jupyterDebugger';
import { JupyterExecutionFactory } from '../../client/datascience/jupyter/jupyterExecutionFactory';
import { JupyterExporter } from '../../client/datascience/jupyter/jupyterExporter';
import { JupyterImporter } from '../../client/datascience/jupyter/jupyterImporter';
import { JupyterNotebookProvider } from '../../client/datascience/jupyter/jupyterNotebookProvider';
import { JupyterPasswordConnect } from '../../client/datascience/jupyter/jupyterPasswordConnect';
import { JupyterServerWrapper } from '../../client/datascience/jupyter/jupyterServerWrapper';
import { JupyterSessionManagerFactory } from '../../client/datascience/jupyter/jupyterSessionManagerFactory';
import { JupyterVariables } from '../../client/datascience/jupyter/jupyterVariables';
import { KernelDependencyService } from '../../client/datascience/jupyter/kernels/kernelDependencyService';
import { KernelSelectionProvider } from '../../client/datascience/jupyter/kernels/kernelSelections';
import { KernelSelector } from '../../client/datascience/jupyter/kernels/kernelSelector';
import { KernelService } from '../../client/datascience/jupyter/kernels/kernelService';
import { KernelSwitcher } from '../../client/datascience/jupyter/kernels/kernelSwitcher';
import { KernelVariables } from '../../client/datascience/jupyter/kernelVariables';
import { NotebookStarter } from '../../client/datascience/jupyter/notebookStarter';
import { OldJupyterVariables } from '../../client/datascience/jupyter/oldJupyterVariables';
import { ServerPreload } from '../../client/datascience/jupyter/serverPreload';
import { JupyterServerSelector } from '../../client/datascience/jupyter/serverSelector';
import { JupyterDebugService } from '../../client/datascience/jupyterDebugService';
import { JupyterUriProviderRegistration } from '../../client/datascience/jupyterUriProviderRegistration';
import { KernelDaemonPreWarmer } from '../../client/datascience/kernel-launcher/kernelDaemonPreWarmer';
import { KernelFinder } from '../../client/datascience/kernel-launcher/kernelFinder';
import { KernelLauncher } from '../../client/datascience/kernel-launcher/kernelLauncher';
import { IKernelFinder, IKernelLauncher } from '../../client/datascience/kernel-launcher/types';
import { NotebookCreationTracker } from '../../client/datascience/notebookAndInteractiveTracker';
import { NotebookExtensibility } from '../../client/datascience/notebookExtensibility';
import { NotebookModelFactory } from '../../client/datascience/notebookStorage/factory';
import { NativeEditorStorage } from '../../client/datascience/notebookStorage/nativeEditorStorage';
import {
    INotebookStorageProvider,
    NotebookStorageProvider
} from '../../client/datascience/notebookStorage/notebookStorageProvider';
import { INotebookModelFactory } from '../../client/datascience/notebookStorage/types';
import { PlotViewer } from '../../client/datascience/plotting/plotViewer';
import { PlotViewerProvider } from '../../client/datascience/plotting/plotViewerProvider';
import { ProgressReporter } from '../../client/datascience/progress/progressReporter';
import { RawNotebookProviderWrapper } from '../../client/datascience/raw-kernel/rawNotebookProviderWrapper';
import { RawNotebookSupportedService } from '../../client/datascience/raw-kernel/rawNotebookSupportedService';
import { StatusProvider } from '../../client/datascience/statusProvider';
import { ThemeFinder } from '../../client/datascience/themeFinder';
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
    IDataScienceFileSystem,
    IDebugLocationTracker,
    IDigestStorage,
    IGatherLogger,
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
    IJupyterSessionManagerFactory,
    IJupyterSubCommandExecutionService,
    IJupyterUriProviderRegistration,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    IKernelDependencyService,
    INotebookCreationTracker,
    INotebookEditor,
    INotebookEditorProvider,
    INotebookExecutionLogger,
    INotebookExporter,
    INotebookExtensibility,
    INotebookImporter,
    INotebookProvider,
    INotebookServer,
    INotebookStorage,
    IPlotViewer,
    IPlotViewerProvider,
    IRawNotebookProvider,
    IRawNotebookSupportedService,
    IStatusProvider,
    IThemeFinder,
    ITrustService
} from '../../client/datascience/types';
import { ProtocolParser } from '../../client/debugger/extension/helpers/protocolParser';
import { IProtocolParser } from '../../client/debugger/extension/types';
import { IEnvironmentActivationService } from '../../client/interpreter/activation/types';
import { IInterpreterSelector } from '../../client/interpreter/configuration/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IWindowsStoreInterpreter } from '../../client/interpreter/locators/types';
import { trustDirectoryMigrated } from '../../client/migration/migrateDigestStorage';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { CodeExecutionHelper } from '../../client/terminals/codeExecution/helper';
import { ICodeExecutionHelper } from '../../client/terminals/types';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';
import { EnvironmentActivationService } from '../interpreters/envActivation';
import { InterpreterService } from '../interpreters/interpreterService';
import { InterpreterSelector } from '../interpreters/selector';
import { WindowsStoreInterpreter } from '../interpreters/winStoreInterpreter';
import { MockOutputChannel } from '../mockClasses';
import { MockMemento } from '../mocks/mementos';
import { UnitTestIocContainer } from '../testing/serviceRegistry';
import { MockCommandManager } from './mockCommandManager';
import { MockCustomEditorService } from './mockCustomEditorService';
import { MockDebuggerService } from './mockDebugService';
import { MockDocumentManager } from './mockDocumentManager';
import { MockExtensions } from './mockExtensions';
import { MockFileSystem } from './mockFileSystem';
import { MockJupyterManager, SupportedCommands } from './mockJupyterManager';
import { MockJupyterManagerFactory } from './mockJupyterManagerFactory';
import { MockJupyterSettings } from './mockJupyterSettings';
import { MockLiveShareApi } from './mockLiveShare';
import { MockWorkspaceConfiguration } from './mockWorkspaceConfig';
import { MockWorkspaceFolder } from './mockWorkspaceFolder';
import { IMountedWebView } from './mountedWebView';
import { IMountedWebViewFactory, MountedWebViewFactory } from './mountedWebViewFactory';
import { TestExecutionLogger } from './testexecutionLogger';
import { TestInteractiveWindowProvider } from './testInteractiveWindowProvider';
import {
    ITestNativeEditorProvider,
    TestNativeEditorProvider,
    TestNativeEditorProviderOld
} from './testNativeEditorProvider';
import { TestPersistentStateFactory } from './testPersistentStateFactory';
import { WebBrowserPanelProvider } from './uiTests/webBrowserPanelProvider';

export class DataScienceIocContainer extends UnitTestIocContainer {
    public get workingInterpreter() {
        return this.workingPython;
    }

    public get workingInterpreter2() {
        return this.workingPython2;
    }

    public get onContextSet(): Event<{ name: string; value: boolean }> {
        return this.contextSetEvent.event;
    }

    public get mockJupyter(): MockJupyterManager | undefined {
        return this.jupyterMock ? this.jupyterMock.getManager() : undefined;
    }

    public get kernelService() {
        return this.kernelServiceMock;
    }
    private static jupyterInterpreters: PythonEnvironment[] = [];
    public applicationShell!: ApplicationShell;
    // tslint:disable-next-line:no-any
    public datascience!: TypeMoq.IMock<IDataScience>;
    public shouldMockJupyter: boolean;
    private commandManager: MockCommandManager = new MockCommandManager();
    private setContexts: Record<string, boolean> = {};
    private contextSetEvent: EventEmitter<{ name: string; value: boolean }> = new EventEmitter<{
        name: string;
        value: boolean;
    }>();
    private jupyterMock: MockJupyterManagerFactory | undefined;
    private asyncRegistry: AsyncDisposableRegistry;
    private configChangeEvent = new EventEmitter<ConfigurationChangeEvent>();
    private worksaceFoldersChangedEvent = new EventEmitter<WorkspaceFoldersChangeEvent>();
    private documentManager = new MockDocumentManager();
    private workingPython: PythonEnvironment = {
        path: '/foo/bar/python.exe',
        version: new SemVer('3.6.6-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        displayName: 'Python'
    };
    private workingPython2: PythonEnvironment = {
        path: '/foo/baz/python.exe',
        version: new SemVer('3.6.7-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        displayName: 'Python'
    };

    private webPanelProvider = mock(WebviewPanelProvider);
    private settingsMap = new Map<string, any>();
    private configMap = new Map<string, MockWorkspaceConfiguration>();
    private emptyConfig = new MockWorkspaceConfiguration();
    private workspaceFolders: MockWorkspaceFolder[] = [];
    private kernelServiceMock = mock(KernelService);
    private disposed = false;
    private experimentState = new Map<string, boolean>();
    private extensionRootPath: string | undefined;
    private pendingWebPanel: IMountedWebView | undefined;

    constructor(private readonly uiTest: boolean = false) {
        super();
        this.useVSCodeAPI = false;
        const isRollingBuild = process.env ? process.env.VSCODE_PYTHON_ROLLING !== undefined : false;
        this.shouldMockJupyter = !isRollingBuild;
        this.asyncRegistry = new AsyncDisposableRegistry();
    }

    public async dispose(): Promise<void> {
        // Make sure to disable all command handling during dispose. Don't want
        // anything to startup again.
        this.commandManager.dispose();
        try {
            // Make sure to delete any temp files written by native editor storage
            const globPr = promisify(glob);
            const tempLocation = os.tmpdir;
            const tempFiles = await globPr(`${tempLocation}/*.ipynb`);
            if (tempFiles && tempFiles.length) {
                await Promise.all(tempFiles.map((t) => fs.remove(t)));
            }
        } catch (exc) {
            // tslint:disable-next-line: no-console
            console.log(`Exception on cleanup: ${exc}`);
        }
        await this.asyncRegistry.dispose();
        await super.dispose();
        this.disposed = true;

        if (!this.uiTest) {
            // Blur window focus so we don't have editors polling
            // tslint:disable-next-line: no-require-imports
            const reactHelpers = require('./reactHelpers') as typeof import('./reactHelpers');
            reactHelpers.blurWindow();
        }

        // Bounce this so that our editor has time to shutdown
        await sleep(150);

        if (!this.uiTest) {
            // Clear out the monaco global services. Some of these services are preventing shutdown.
            // tslint:disable: no-require-imports
            const services = require('monaco-editor/esm/vs/editor/standalone/browser/standaloneServices') as any;
            if (services.StaticServices) {
                const keys = Object.keys(services.StaticServices);
                keys.forEach((k) => {
                    const service = services.StaticServices[k] as any;
                    if (service && service._value && service._value.dispose) {
                        if (typeof service._value.dispose === 'function') {
                            service._value.dispose();
                        }
                    }
                });
            }
            // This file doesn't have an export so we can't force a dispose. Instead it has a 5 second timeout
            const config = require('monaco-editor/esm/vs/editor/browser/config/configuration') as any;
            if (config.getCSSBasedConfiguration) {
                config.getCSSBasedConfiguration().dispose();
            }
        }

        // Because there are outstanding promises holding onto this object, clear out everything we can
        this.workspaceFolders = [];
        this.settingsMap.clear();
        this.configMap.clear();
        this.setContexts = {};
        reset(this.webPanelProvider);
    }

    //tslint:disable:max-func-body-length
    public registerDataScienceTypes(useCustomEditor: boolean = false) {
        this.serviceManager.addSingletonInstance<number>(DataScienceStartupTime, Date.now());
        this.serviceManager.addSingletonInstance<DataScienceIocContainer>(DataScienceIocContainer, this);

        // Create the workspace service first as it's used to set config values.
        this.createWorkspaceService();

        // Setup our webpanel provider to create our dummy web panel
        when(this.webPanelProvider.create(anything())).thenCall(this.onCreateWebPanel.bind(this));
        if (this.uiTest) {
            this.serviceManager.addSingleton<IWebviewPanelProvider>(IWebviewPanelProvider, WebBrowserPanelProvider);
            this.serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, IPyWidgetScriptSource);
            this.serviceManager.addSingleton<IHttpClient>(IHttpClient, HttpClient);
        } else {
            this.serviceManager.addSingletonInstance<IWebviewPanelProvider>(
                IWebviewPanelProvider,
                instance(this.webPanelProvider)
            );
        }
        this.serviceManager.addSingleton<INotebookExtensibility>(INotebookExtensibility, NotebookExtensibility);
        this.serviceManager.addSingleton<IExportManager>(IExportManager, ExportManager);
        this.serviceManager.addSingleton<ExportDependencyChecker>(ExportDependencyChecker, ExportDependencyChecker);
        this.serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);
        this.serviceManager.addSingleton<IExport>(IExport, ExportToPDF, ExportFormat.pdf);
        this.serviceManager.addSingleton<IExport>(IExport, ExportToHTML, ExportFormat.html);
        this.serviceManager.addSingleton<IExport>(IExport, ExportToPython, ExportFormat.python);
        this.serviceManager.addSingleton<IExport>(IExport, ExportBase, 'Export Base');
        this.serviceManager.addSingleton<ExportUtil>(ExportUtil, ExportUtil);
        this.serviceManager.addSingleton<ExportCommands>(ExportCommands, ExportCommands);
        this.serviceManager.addSingleton<IExportManagerFilePicker>(IExportManagerFilePicker, ExportManagerFilePicker);

        this.serviceManager.addSingleton<INotebookModelFactory>(INotebookModelFactory, NotebookModelFactory);
        this.serviceManager.addSingleton<IMountedWebViewFactory>(IMountedWebViewFactory, MountedWebViewFactory);
        this.registerFileSystemTypes();
        this.serviceManager.addSingletonInstance<IDataScienceFileSystem>(IDataScienceFileSystem, new MockFileSystem());
        this.serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, JupyterExecutionFactory);
        this.serviceManager.addSingleton<IInteractiveWindowProvider>(
            IInteractiveWindowProvider,
            TestInteractiveWindowProvider
        );
        this.serviceManager.addSingletonInstance(UseProposedApi, false);
        this.serviceManager.addSingletonInstance(UseCustomEditorApi, useCustomEditor);
        this.serviceManager.addSingletonInstance(UseVSCodeNotebookEditorApi, false);
        this.serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
        this.serviceManager.add<IJupyterVariableDataProvider>(
            IJupyterVariableDataProvider,
            JupyterVariableDataProvider
        );
        this.serviceManager.addSingleton<IJupyterVariableDataProviderFactory>(
            IJupyterVariableDataProviderFactory,
            JupyterVariableDataProviderFactory
        );
        this.serviceManager.addSingleton<IPlotViewerProvider>(IPlotViewerProvider, PlotViewerProvider);
        this.serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
        this.serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);

        const experimentService = mock(ExperimentService);
        this.serviceManager.addSingletonInstance<IExperimentService>(IExperimentService, instance(experimentService));

        this.serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
        this.serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
        this.serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);
        this.serviceManager.addSingleton<ILiveShareApi>(ILiveShareApi, MockLiveShareApi);
        this.serviceManager.addSingleton<IExtensions>(IExtensions, MockExtensions);
        this.serviceManager.add<INotebookServer>(INotebookServer, JupyterServerWrapper);
        this.serviceManager.add<IJupyterCommandFactory>(IJupyterCommandFactory, JupyterCommandFactory);
        this.serviceManager.addSingleton<IRawNotebookProvider>(IRawNotebookProvider, RawNotebookProviderWrapper);
        this.serviceManager.addSingleton<IRawNotebookSupportedService>(
            IRawNotebookSupportedService,
            RawNotebookSupportedService
        );
        this.serviceManager.addSingleton<IThemeFinder>(IThemeFinder, ThemeFinder);
        this.serviceManager.addSingleton<ICodeCssGenerator>(ICodeCssGenerator, CodeCssGenerator);
        this.serviceManager.addSingleton<IStatusProvider>(IStatusProvider, StatusProvider);
        this.serviceManager.addSingleton<IBrowserService>(IBrowserService, BrowserService);
        this.serviceManager.addSingletonInstance<IAsyncDisposableRegistry>(
            IAsyncDisposableRegistry,
            this.asyncRegistry
        );
        this.serviceManager.add<ICodeWatcher>(ICodeWatcher, CodeWatcher);
        this.serviceManager.add<IDataScienceCodeLensProvider>(
            IDataScienceCodeLensProvider,
            DataScienceCodeLensProvider
        );
        this.serviceManager.add<ICodeExecutionHelper>(ICodeExecutionHelper, CodeExecutionHelper);
        this.serviceManager.add<IDataScienceCommandListener>(
            IDataScienceCommandListener,
            InteractiveWindowCommandListener
        );
        this.serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
        this.serviceManager.addSingleton<IExtensionSingleActivationService>(
            IExtensionSingleActivationService,
            DebuggerVariableRegistration
        );
        this.serviceManager.addSingleton<IJupyterVariables>(
            IJupyterVariables,
            JupyterVariables,
            Identifiers.ALL_VARIABLES
        );
        this.serviceManager.addSingleton<IJupyterVariables>(
            IJupyterVariables,
            OldJupyterVariables,
            Identifiers.OLD_VARIABLES
        );
        this.serviceManager.addSingleton<IJupyterVariables>(
            IJupyterVariables,
            KernelVariables,
            Identifiers.KERNEL_VARIABLES
        );
        this.serviceManager.addSingleton<IJupyterVariables>(
            IJupyterVariables,
            DebuggerVariables,
            Identifiers.DEBUGGER_VARIABLES
        );
        this.serviceManager.addSingleton<IJupyterDebugger>(IJupyterDebugger, JupyterDebugger, undefined, [
            ICellHashListener
        ]);
        this.serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory);
        this.serviceManager.addSingleton<INotebookEditorProvider>(
            INotebookEditorProvider,
            useCustomEditor ? TestNativeEditorProvider : TestNativeEditorProviderOld
        );
        this.serviceManager.addSingleton<DataViewerDependencyService>(
            DataViewerDependencyService,
            DataViewerDependencyService
        );

        this.serviceManager.addSingleton<IDataScienceCommandListener>(
            IDataScienceCommandListener,
            NativeEditorCommandListener
        );
        this.serviceManager.addSingletonInstance<IOutputChannel>(
            IOutputChannel,
            mock(MockOutputChannel),
            JUPYTER_OUTPUT_CHANNEL
        );
        this.serviceManager.addSingleton<ICryptoUtils>(ICryptoUtils, CryptoUtils);
        this.serviceManager.addSingleton<IExtensionSingleActivationService>(
            IExtensionSingleActivationService,
            ServerPreload
        );
        const mockExtensionContext = TypeMoq.Mock.ofType<IExtensionContext>();
        mockExtensionContext.setup((m) => m.globalStoragePath).returns(() => os.tmpdir());
        const globalState = new MockMemento();
        globalState.update(trustDirectoryMigrated, true);
        mockExtensionContext.setup((m) => m.globalState).returns(() => globalState);
        mockExtensionContext.setup((m) => m.extensionPath).returns(() => this.extensionRootPath || os.tmpdir());
        this.serviceManager.addSingletonInstance<IExtensionContext>(IExtensionContext, mockExtensionContext.object);

        const mockServerSelector = mock(JupyterServerSelector);
        this.serviceManager.addSingletonInstance<JupyterServerSelector>(
            JupyterServerSelector,
            instance(mockServerSelector)
        );

        this.serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
        this.serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);
        this.serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, NotebookServerProvider);

        this.serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, IntellisenseProvider);
        this.serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, AutoSaveService);
        this.serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, GatherListener);
        this.serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, NativeEditorRunByLineListener);
        this.serviceManager.addSingleton<IPyWidgetMessageDispatcherFactory>(
            IPyWidgetMessageDispatcherFactory,
            IPyWidgetMessageDispatcherFactory
        );
        if (this.uiTest) {
            this.serviceManager.add<IInteractiveWindowListener>(IInteractiveWindowListener, IPyWidgetHandler);
        }
        this.serviceManager.add<IProtocolParser>(IProtocolParser, ProtocolParser);
        this.serviceManager.addSingleton<IJupyterDebugService>(
            IJupyterDebugService,
            JupyterDebugService,
            Identifiers.RUN_BY_LINE_DEBUGSERVICE
        );
        const mockDebugService = new MockDebuggerService(
            this.serviceManager.get<IJupyterDebugService>(IJupyterDebugService, Identifiers.RUN_BY_LINE_DEBUGSERVICE)
        );
        this.serviceManager.addSingletonInstance<IDebugService>(IDebugService, mockDebugService);
        this.serviceManager.addSingletonInstance<IJupyterDebugService>(
            IJupyterDebugService,
            mockDebugService,
            Identifiers.MULTIPLEXING_DEBUGSERVICE
        );
        this.serviceManager.add<ICellHashProvider>(ICellHashProvider, CellHashProvider, undefined, [
            INotebookExecutionLogger
        ]);
        this.serviceManager.addSingleton<INotebookExecutionLogger>(INotebookExecutionLogger, HoverProvider);
        this.serviceManager.add<IGatherLogger>(IGatherLogger, GatherLogger, undefined, [INotebookExecutionLogger]);
        this.serviceManager.add<INotebookExecutionLogger>(INotebookExecutionLogger, TestExecutionLogger);
        this.serviceManager.addSingleton<ICodeLensFactory>(ICodeLensFactory, CodeLensFactory, undefined, [
            IInteractiveWindowListener
        ]);
        this.serviceManager.addSingleton<NotebookStarter>(NotebookStarter, NotebookStarter);
        this.serviceManager.addSingleton<KernelSelector>(KernelSelector, KernelSelector);
        this.serviceManager.addSingleton<KernelSelectionProvider>(KernelSelectionProvider, KernelSelectionProvider);
        this.serviceManager.addSingleton<KernelSwitcher>(KernelSwitcher, KernelSwitcher);
        this.serviceManager.addSingleton<IKernelDependencyService>(IKernelDependencyService, KernelDependencyService);
        this.serviceManager.addSingleton<INotebookCreationTracker>(INotebookCreationTracker, NotebookCreationTracker);
        this.serviceManager.addSingleton<KernelDaemonPool>(KernelDaemonPool, KernelDaemonPool);
        this.serviceManager.addSingleton<KernelDaemonPreWarmer>(KernelDaemonPreWarmer, KernelDaemonPreWarmer);
        this.serviceManager.addSingleton<IVSCodeNotebook>(IVSCodeNotebook, VSCodeNotebook);
        this.serviceManager.addSingleton<IProductPathService>(IProductPathService, DataScienceProductPathService);
        this.serviceManager.addSingleton<IMultiStepInputFactory>(IMultiStepInputFactory, MultiStepInputFactory);

        // No need of reporting progress.
        const progressReporter = mock(ProgressReporter);
        when(progressReporter.createProgressIndicator(anything())).thenReturn({
            dispose: noop,
            token: new CancellationTokenSource().token
        });
        this.serviceManager.addSingletonInstance<ProgressReporter>(ProgressReporter, instance(progressReporter));

        // Turn off experiments.
        const experimentManager = mock(ExperimentsManager);
        when(experimentManager.inExperiment(anything())).thenCall((exp) => {
            const setState = this.experimentState.get(exp);
            if (setState === undefined) {
                if (this.shouldMockJupyter) {
                    // RawKernel doesn't currently have a mock layer
                    return exp !== LocalZMQKernel.experiment;
                } else {
                    // All experiments to true by default if not mocking jupyter
                    return true;
                }
            }
            return setState;
        });
        when(experimentManager.activate()).thenResolve();
        this.serviceManager.addSingletonInstance<IExperimentsManager>(IExperimentsManager, instance(experimentManager));

        // Setup our command list
        this.commandManager.registerCommand('setContext', (name: string, value: boolean) => {
            this.setContexts[name] = value;
            this.contextSetEvent.fire({ name: name, value: value });
        });
        this.serviceManager.addSingletonInstance<ICommandManager>(ICommandManager, this.commandManager);

        // Mock the app shell
        this.applicationShell = mock(ApplicationShell);
        const configurationService = TypeMoq.Mock.ofType<IConfigurationService>();

        configurationService.setup((c) => c.getSettings(TypeMoq.It.isAny())).returns(this.getSettings.bind(this));

        this.serviceManager.addSingleton<IEnvironmentVariablesProvider>(
            IEnvironmentVariablesProvider,
            EnvironmentVariablesProvider
        );

        this.serviceManager.addSingletonInstance<IApplicationShell>(IApplicationShell, instance(this.applicationShell));
        this.serviceManager.addSingletonInstance<IDocumentManager>(IDocumentManager, this.documentManager);
        this.serviceManager.addSingletonInstance<IConfigurationService>(
            IConfigurationService,
            configurationService.object
        );

        this.datascience = TypeMoq.Mock.ofType<IDataScience>();
        this.serviceManager.addSingletonInstance<IDataScience>(IDataScience, this.datascience.object);
        this.serviceManager.addSingleton<JupyterCommandLineSelector>(
            JupyterCommandLineSelector,
            JupyterCommandLineSelector
        );
        this.serviceManager.addSingleton<JupyterCommandLineSelectorCommand>(
            JupyterCommandLineSelectorCommand,
            JupyterCommandLineSelectorCommand
        );

        this.serviceManager.addSingleton<JupyterServerSelectorCommand>(
            JupyterServerSelectorCommand,
            JupyterServerSelectorCommand
        );
        this.serviceManager.addSingleton<NotebookCommands>(NotebookCommands, NotebookCommands);

        this.serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
        this.serviceManager.addSingleton<IBufferDecoder>(IBufferDecoder, BufferDecoder);
        this.serviceManager.addSingleton<IEnvironmentVariablesService>(
            IEnvironmentVariablesService,
            EnvironmentVariablesService
        );
        this.serviceManager.addSingleton<IPathUtils>(IPathUtils, PathUtils);
        this.serviceManager.addSingletonInstance<boolean>(IsWindows, IS_WINDOWS);

        const globalStorage = this.serviceManager.get<Memento>(IMemento, GLOBAL_MEMENTO);
        const localStorage = this.serviceManager.get<Memento>(IMemento, WORKSPACE_MEMENTO);

        // Create a custom persistent state factory that remembers specific things between tests
        this.serviceManager.addSingletonInstance<IPersistentStateFactory>(
            IPersistentStateFactory,
            new TestPersistentStateFactory(globalStorage, localStorage)
        );

        const currentProcess = new CurrentProcess();
        this.serviceManager.addSingletonInstance<ICurrentProcess>(ICurrentProcess, currentProcess);

        this.serviceManager.addSingleton<JupyterInterpreterStateStore>(
            JupyterInterpreterStateStore,
            JupyterInterpreterStateStore
        );
        this.serviceManager.addSingleton<IExtensionSingleActivationService>(
            IExtensionSingleActivationService,
            JupyterInterpreterSelectionCommand
        );
        this.serviceManager.addSingleton<JupyterInterpreterSelector>(
            JupyterInterpreterSelector,
            JupyterInterpreterSelector
        );
        this.serviceManager.addSingleton<JupyterInterpreterDependencyService>(
            JupyterInterpreterDependencyService,
            JupyterInterpreterDependencyService
        );
        this.serviceManager.addSingleton<JupyterInterpreterService>(
            JupyterInterpreterService,
            JupyterInterpreterService
        );
        this.serviceManager.addSingleton<JupyterInterpreterOldCacheStateStore>(
            JupyterInterpreterOldCacheStateStore,
            JupyterInterpreterOldCacheStateStore
        );
        this.serviceManager.addSingleton<ActiveEditorContextService>(
            ActiveEditorContextService,
            ActiveEditorContextService
        );
        this.serviceManager.addSingleton<IKernelLauncher>(IKernelLauncher, KernelLauncher);
        this.serviceManager.addSingleton<IKernelFinder>(IKernelFinder, KernelFinder);

        this.serviceManager.addSingleton<IJupyterSubCommandExecutionService>(
            IJupyterSubCommandExecutionService,
            JupyterInterpreterSubCommandExecutionService
        );
        this.serviceManager.addSingleton<IJupyterInterpreterDependencyManager>(
            IJupyterInterpreterDependencyManager,
            JupyterInterpreterSubCommandExecutionService
        );

        this.serviceManager.add<INotebookStorage>(INotebookStorage, NativeEditorStorage);
        this.serviceManager.addSingleton<INotebookStorageProvider>(INotebookStorageProvider, NotebookStorageProvider);
        this.serviceManager.addSingleton<ICustomEditorService>(ICustomEditorService, MockCustomEditorService);
        this.serviceManager.addSingletonInstance<IPythonDebuggerPathProvider>(IPythonDebuggerPathProvider, {
            getDebuggerPath: async () => path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'pythonFiles', 'lib', 'python')
        });

        // Create our jupyter mock if necessary
        if (this.shouldMockJupyter) {
            this.jupyterMock = new MockJupyterManagerFactory(this.serviceManager);
            // When using mocked Jupyter, default to using default kernel.
            when(this.kernelServiceMock.searchAndRegisterKernel(anything(), anything())).thenResolve(undefined);
            when(this.kernelServiceMock.getKernelSpecs(anything(), anything())).thenResolve([]);
            this.serviceManager.addSingletonInstance<KernelService>(KernelService, instance(this.kernelServiceMock));

            this.serviceManager.addSingletonInstance<IInterpreterSelector>(
                IInterpreterSelector,
                instance(mock(InterpreterSelector))
            );
            this.serviceManager.addSingletonInstance<IWindowsStoreInterpreter>(
                IWindowsStoreInterpreter,
                instance(mock(WindowsStoreInterpreter))
            );
            this.serviceManager.addSingletonInstance<IEnvironmentActivationService>(
                IEnvironmentActivationService,
                instance(mock(EnvironmentActivationService))
            );
        } else {
            this.serviceManager.addSingleton<IInstaller>(IInstaller, ProductInstaller);
            this.serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
            this.serviceManager.addSingleton<IInterpreterSelector>(IInterpreterSelector, InterpreterSelector);
            this.serviceManager.addSingleton<IWindowsStoreInterpreter>(
                IWindowsStoreInterpreter,
                WindowsStoreInterpreter
            );
            this.serviceManager.addSingleton<IEnvironmentActivationService>(
                IEnvironmentActivationService,
                EnvironmentActivationService
            );
            this.serviceManager.addSingleton<KernelService>(KernelService, KernelService);
            this.serviceManager.addSingleton<IProcessServiceFactory>(IProcessServiceFactory, ProcessServiceFactory);
            this.serviceManager.addSingleton<IPythonExecutionFactory>(IPythonExecutionFactory, PythonExecutionFactory);

            this.serviceManager.addSingleton<IJupyterSessionManagerFactory>(
                IJupyterSessionManagerFactory,
                JupyterSessionManagerFactory
            );
            this.serviceManager.addSingleton<IJupyterPasswordConnect>(IJupyterPasswordConnect, JupyterPasswordConnect);
            this.serviceManager.addSingleton<IProcessLogger>(IProcessLogger, ProcessLogger);
        }
        this.serviceManager.addSingleton<NativeEditorSynchronizer>(NativeEditorSynchronizer, NativeEditorSynchronizer);
        this.serviceManager.addSingleton<ITrustService>(ITrustService, TrustService);
        this.serviceManager.addSingleton<IDigestStorage>(IDigestStorage, DigestStorage);
        // Disable syncrhonizing edits
        this.serviceContainer.get<NativeEditorSynchronizer>(NativeEditorSynchronizer).disable();
        const dummyDisposable = {
            dispose: () => {
                return;
            }
        };

        when(this.applicationShell.showErrorMessage(anyString())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showErrorMessage(anyString(), anything())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showErrorMessage(anyString(), anything(), anything())).thenReturn(
            Promise.resolve('')
        );
        when(this.applicationShell.showInformationMessage(anyString())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showInformationMessage(anyString(), anything())).thenReturn(Promise.resolve(''));
        when(
            this.applicationShell.showInformationMessage(anyString(), anything(), anything())
        ).thenCall((_a1, a2, _a3) => Promise.resolve(a2));
        when(this.applicationShell.showInformationMessage(anyString(), anything(), anything(), anything())).thenCall(
            (_a1, a2, _a3, a4) => {
                if (typeof a2 === 'string') {
                    return Promise.resolve(a2);
                } else {
                    return Promise.resolve(a4);
                }
            }
        );
        when(this.applicationShell.showWarningMessage(anyString())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showWarningMessage(anyString(), anything())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showWarningMessage(anyString(), anything(), anything())).thenCall((_a1, a2, _a3) =>
            Promise.resolve(a2)
        );
        when(this.applicationShell.showWarningMessage(anyString(), anything(), anything(), anything())).thenCall(
            (_a1, a2, _a3, a4) => {
                if (typeof a2 === 'string') {
                    return Promise.resolve(a2);
                } else {
                    return Promise.resolve(a4);
                }
            }
        );
        when(this.applicationShell.showSaveDialog(anything())).thenReturn(Promise.resolve(Uri.file('test.ipynb')));
        when(this.applicationShell.setStatusBarMessage(anything())).thenReturn(dummyDisposable);
        when(this.applicationShell.showInputBox(anything())).thenReturn(Promise.resolve('Python'));
        const eventCallback = (
            _listener: (e: WindowState) => any,
            _thisArgs?: any,
            _disposables?: IDisposable[] | Disposable
        ) => {
            return {
                dispose: noop
            };
        };
        when(this.applicationShell.onDidChangeWindowState).thenReturn(eventCallback);
        when(this.applicationShell.withProgress(anything(), anything())).thenCall((_o, c) => c());

        if (this.mockJupyter) {
            this.addInterpreter(this.workingPython2, SupportedCommands.all);
            this.addInterpreter(this.workingPython, SupportedCommands.all);
        }
        this.serviceManager.addSingleton<IJupyterUriProviderRegistration>(
            IJupyterUriProviderRegistration,
            JupyterUriProviderRegistration
        );
    }
    public setFileContents(uri: Uri, contents: string) {
        const fileSystem = this.serviceManager.get<IDataScienceFileSystem>(IDataScienceFileSystem) as MockFileSystem;
        fileSystem.addFileContents(uri.fsPath, contents);
    }

    public async activate(): Promise<void> {
        // Activate all of the extension activation services
        const activationServices = this.serviceManager.getAll<IExtensionSingleActivationService>(
            IExtensionSingleActivationService
        );

        await Promise.all(activationServices.map((a) => a.activate()));

        // Make sure the command registry registers all commands
        this.get<CommandRegistry>(CommandRegistry).register();

        // Then force our interpreter to be one that supports jupyter (unless in a mock state when we don't have to)
        if (!this.mockJupyter) {
            const interpreterService = this.serviceManager.get<IInterpreterService>(IInterpreterService);
            const activeInterpreter = await interpreterService.getActiveInterpreter();
            if (!activeInterpreter || !(await this.hasFunctionalDependencies(activeInterpreter))) {
                const list = await this.getFunctionalTestInterpreters();
                if (list.length) {
                    this.forceSettingsChanged(undefined, list[0].path, {});

                    // Log this all the time. Useful in determining why a test may not pass.
                    const message = `Setting interpreter to ${list[0].displayName || list[0].path} -> ${list[0].path}`;
                    traceInfo(message);
                    // tslint:disable-next-line: no-console
                    console.log(message);

                    // Also set this as the interpreter to use for jupyter
                    await this.serviceManager
                        .get<JupyterInterpreterService>(JupyterInterpreterService)
                        .setAsSelectedInterpreter(list[0]);
                } else {
                    throw new Error(
                        'No jupyter capable interpreter found. Make sure you install all of the functional requirements before running a test'
                    );
                }
            }
        }
    }

    // tslint:disable:any
    public createWebView(
        mount: () => ReactWrapper<any, Readonly<{}>, React.Component>,
        id: string,
        role: vsls.Role = vsls.Role.None
    ) {
        // Force the container to mock actual live share if necessary
        if (role !== vsls.Role.None) {
            const liveShareTest = this.get<ILiveShareApi>(ILiveShareApi) as ILiveShareTestingApi;
            liveShareTest.forceRole(role);
        }

        // We need to mount the react control before we even create an interactive window object. Otherwise the mount will miss rendering some parts
        this.pendingWebPanel = this.get<IMountedWebViewFactory>(IMountedWebViewFactory).create(id, mount);
        return this.pendingWebPanel;
    }

    public getWrapper(type: 'notebook' | 'interactive') {
        if (type === 'notebook') {
            return this.getNativeWebPanel(undefined).wrapper;
        } else {
            return this.getInteractiveWebPanel(undefined).wrapper;
        }
    }

    public getInteractiveWebPanel(window: IInteractiveWindow | undefined) {
        return this.get<TestInteractiveWindowProvider>(IInteractiveWindowProvider).getMountedWebView(window);
    }

    public getNativeWebPanel(window: INotebookEditor | undefined) {
        return this.get<ITestNativeEditorProvider>(INotebookEditorProvider).getMountedWebView(window);
    }

    public getContext(name: string): boolean {
        if (this.setContexts.hasOwnProperty(name)) {
            return this.setContexts[name];
        }

        return false;
    }

    public getSettings(resource?: Uri): IWatchableJupyterSettings {
        const key = this.getResourceKey(resource);
        let setting = this.settingsMap.get(key);
        if (!setting && !this.disposed) {
            // Make sure we have the default config for this resource first.
            this.getWorkspaceConfig('jupyter', resource);
            setting = new MockJupyterSettings(resource, this.serviceManager.get<IWorkspaceService>(IWorkspaceService));
            this.settingsMap.set(key, setting);
        } else if (this.disposed) {
            setting = this.generateJupyterSettings();
        }
        return setting;
    }

    public forceDataScienceSettingsChanged(dataScienceSettings: Partial<IJupyterSettings>) {
        this.forceSettingsChanged(undefined, '', dataScienceSettings);
    }

    public setExtensionRootPath(newRoot: string) {
        this.extensionRootPath = newRoot;
    }

    public async getJupyterCapableInterpreter(): Promise<PythonEnvironment | undefined> {
        const list = await this.getFunctionalTestInterpreters();
        return list ? list[0] : undefined;
    }

    public async getFunctionalTestInterpreters(): Promise<PythonEnvironment[]> {
        // This should be cacheable as we don't install new interpreters during tests
        if (DataScienceIocContainer.jupyterInterpreters.length > 0) {
            return DataScienceIocContainer.jupyterInterpreters;
        }
        const list = await this.get<IInterpreterService>(IInterpreterService).getInterpreters(undefined);
        const promises = list.map((f) => this.hasFunctionalDependencies(f).then((b) => (b ? f : undefined)));
        const resolved = await Promise.all(promises);
        DataScienceIocContainer.jupyterInterpreters = resolved.filter((r) => r) as PythonEnvironment[];
        return DataScienceIocContainer.jupyterInterpreters;
    }

    public addWorkspaceFolder(folderPath: string) {
        const workspaceFolder = new MockWorkspaceFolder(folderPath, this.workspaceFolders.length);
        this.workspaceFolders.push(workspaceFolder);
        return workspaceFolder;
    }

    public addResourceToFolder(resource: Uri, folderPath: string) {
        let folder = this.workspaceFolders.find((f) => f.uri.fsPath === folderPath);
        if (!folder) {
            folder = this.addWorkspaceFolder(folderPath);
        }
        folder.ownedResources.add(resource.toString());
    }

    public get<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T {
        return this.serviceManager.get<T>(serviceIdentifier, name);
    }

    public getAll<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T[] {
        return this.serviceManager.getAll<T>(serviceIdentifier, name);
    }

    public addDocument(code: string, file: string) {
        return this.documentManager.addDocument(code, file);
    }

    public addInterpreter(newInterpreter: PythonEnvironment, commands: SupportedCommands) {
        if (this.mockJupyter) {
            this.mockJupyter.addInterpreter(newInterpreter, commands);
        }
    }

    public getWorkspaceConfig(section: string | undefined, resource?: Resource): MockWorkspaceConfiguration {
        if (!section || section !== 'jupyter') {
            return this.emptyConfig;
        }
        const key = this.getResourceKey(resource);
        let result = this.configMap.get(key);
        if (!result) {
            result = this.generateWorkspaceConfig();
            this.configMap.set(key, result);
        }
        return result;
    }

    public setExperimentState(experimentName: string, enabled: boolean) {
        this.experimentState.set(experimentName, enabled);
    }

    private async onCreateWebPanel(options: IWebviewPanelOptions) {
        if (!this.pendingWebPanel) {
            throw new Error('Creating web panel without a mount');
        }
        const panel = this.pendingWebPanel;
        panel.attach(options);
        return panel;
    }
    private forceSettingsChanged(resource: Resource, newPath: string, partial: Partial<IJupyterSettings>) {
        // tslint:disable-next-line: no-suspicious-comment
        // TODO: Python path will not be updated by this code so tests are unlikely to pass
        const settings = this.getSettings(resource) as MockJupyterSettings;
        if (partial) {
            settings.assign(partial);
        }

        // The workspace config must be updated too as a config change event will cause the data to be reread from
        // the config.
        const config = this.getWorkspaceConfig('jupyter', resource);
        // Turn into the JSON only version
        const jsonVersion = JSON.parse(JSON.stringify(settings));
        // Update each key
        const keys = Object.keys(jsonVersion);
        keys.forEach((k) => config.update(k, jsonVersion[k]).ignoreErrors());
        settings.fireChangeEvent();
        this.configChangeEvent.fire({
            affectsConfiguration(_s: string, _r?: Uri): boolean {
                return true;
            }
        });
        this.get<InterpreterService>(IInterpreterService).updateInterpreter(resource, newPath);
    }

    private generateJupyterSettings() {
        // Create a dummy settings just to setup the workspace config
        const settings = new MockJupyterSettings(undefined);

        // Then setup the default values.
        settings.assign({
            allowImportFromNotebook: true,
            alwaysTrustNotebooks: true,
            jupyterLaunchTimeout: 120000,
            jupyterLaunchRetries: 3,
            jupyterServerURI: 'local',
            // tslint:disable-next-line: no-invalid-template-strings
            notebookFileRoot: '${fileDirname}',
            changeDirOnImportExport: false,
            useDefaultConfigForJupyter: true,
            jupyterInterruptTimeout: 10000,
            searchForJupyter: true,
            showCellInputCode: true,
            collapseCellInputCodeByDefault: true,
            allowInput: true,
            maxOutputSize: 400,
            enableScrollingForCellOutputs: true,
            errorBackgroundColor: '#FFFFFF',
            sendSelectionToInteractiveWindow: false,
            codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
            markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
            variableExplorerExclude: 'module;function;builtin_function_or_method',
            liveShareConnectionTimeout: 100,
            enablePlotViewer: true,
            stopOnFirstLineWhileDebugging: true,
            stopOnError: true,
            addGotoCodeLenses: true,
            enableCellCodeLens: true,
            runStartupCommands: '',
            debugJustMyCode: true,
            variableQueries: [],
            jupyterCommandLineArguments: [],
            disableJupyterAutoStart: false,
            widgetScriptSources: ['jsdelivr.com', 'unpkg.com'],
            interactiveWindowMode: 'single'
        });
        return settings;
    }

    private generateWorkspaceConfig(): MockWorkspaceConfiguration {
        const settings = this.generateJupyterSettings();

        // Use these settings to default all of the settings in a python configuration
        return new MockWorkspaceConfiguration(settings);
    }

    private createWorkspaceService() {
        class MockFileSystemWatcher implements FileSystemWatcher {
            public ignoreCreateEvents: boolean = false;
            public ignoreChangeEvents: boolean = false;
            public ignoreDeleteEvents: boolean = false;
            //tslint:disable-next-line:no-any
            public onDidChange(_listener: (e: Uri) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable {
                return { dispose: noop };
            }
            //tslint:disable-next-line:no-any
            public onDidDelete(_listener: (e: Uri) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable {
                return { dispose: noop };
            }
            //tslint:disable-next-line:no-any
            public onDidCreate(_listener: (e: Uri) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable {
                return { dispose: noop };
            }
            public dispose() {
                noop();
            }
        }

        const workspaceService = mock(WorkspaceService);
        this.serviceManager.addSingletonInstance<IWorkspaceService>(IWorkspaceService, instance(workspaceService));
        when(workspaceService.onDidChangeConfiguration).thenReturn(this.configChangeEvent.event);
        when(workspaceService.onDidChangeWorkspaceFolders).thenReturn(this.worksaceFoldersChangedEvent.event);

        // Create another config for other parts of the workspace config.
        when(workspaceService.getConfiguration(anything())).thenCall(this.getWorkspaceConfig.bind(this));
        when(workspaceService.getConfiguration(anything(), anything())).thenCall(this.getWorkspaceConfig.bind(this));
        const testWorkspaceFolder = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');

        when(workspaceService.createFileSystemWatcher(anything(), anything(), anything(), anything())).thenReturn(
            new MockFileSystemWatcher()
        );
        when(workspaceService.createFileSystemWatcher(anything())).thenReturn(new MockFileSystemWatcher());
        when(workspaceService.hasWorkspaceFolders).thenReturn(true);
        when(workspaceService.workspaceFolders).thenReturn(this.workspaceFolders);
        when(workspaceService.rootPath).thenReturn(testWorkspaceFolder);
        when(workspaceService.getWorkspaceFolder(anything())).thenCall(this.getWorkspaceFolder.bind(this));
        this.addWorkspaceFolder(testWorkspaceFolder);
        return workspaceService;
    }

    private getWorkspaceFolder(uri: Resource): WorkspaceFolder | undefined {
        if (uri) {
            return this.workspaceFolders.find((w) => w.ownedResources.has(uri.toString()));
        }
        return undefined;
    }

    private getResourceKey(resource: Resource): string {
        if (!this.disposed) {
            const workspace = this.serviceManager.get<IWorkspaceService>(IWorkspaceService);
            const workspaceFolderUri = JupyterSettings.getSettingsUriAndTarget(resource, workspace).uri;
            return workspaceFolderUri ? workspaceFolderUri.fsPath : '';
        }
        return '';
    }

    private async hasFunctionalDependencies(interpreter: PythonEnvironment): Promise<boolean | undefined> {
        try {
            traceInfo(`Checking ${interpreter.path} for functional dependencies ...`);
            const dependencyChecker = this.serviceManager.get<JupyterInterpreterDependencyService>(
                JupyterInterpreterDependencyService
            );
            if (await dependencyChecker.areDependenciesInstalled(interpreter)) {
                // Functional tests require livelossplot too. Make sure this interpreter has that value as well
                const pythonProcess = await this.serviceContainer
                    .get<IPythonExecutionFactory>(IPythonExecutionFactory)
                    .createActivatedEnvironment({
                        resource: undefined,
                        interpreter,
                        allowEnvironmentFetchExceptions: true
                    });
                const result = pythonProcess.isModuleInstalled('livelossplot'); // Should we check all dependencies?
                traceInfo(`${interpreter.path} has jupyter with livelossplot indicating : ${result}`);
                return result;
            } else {
                traceInfo(`${JSON.stringify(interpreter)} is missing jupyter.`);
            }
        } catch (ex) {
            traceError(`Exception attempting dependency list for ${interpreter.path}: `, ex);
            return false;
        }
    }
}
