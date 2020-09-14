'use strict';

import {
    ConfigurationChangeEvent,
    ConfigurationTarget,
    Disposable,
    Event,
    EventEmitter,
    Uri,
    WorkspaceConfiguration
} from 'vscode';
import '../common/extensions';
import { LogLevel } from '../logging/levels';
import { IWorkspaceService } from './application/types';
import { WorkspaceService } from './application/workspace';
import { isTestExecution } from './constants';
import { ExtensionChannels } from './insidersBuild/types';
import {
    IExperiments,
    IJupyterSettings,
    ILoggingSettings,
    InteractiveWindowMode,
    IVariableQuery,
    LoggingLevelSettingType,
    Resource,
    WidgetCDNs
} from './types';
import { debounceSync } from './utils/decorators';
import { SystemVariables } from './variables/systemVariables';

// tslint:disable:no-require-imports no-var-requires

// tslint:disable-next-line:completed-docs
export class JupyterSettings implements IJupyterSettings {
    public get onDidChange(): Event<void> {
        return this.changed.event;
    }

    private static jupyterSettings: Map<string, JupyterSettings> = new Map<string, JupyterSettings>();
    public experiments!: IExperiments;
    public logging: ILoggingSettings = { level: LogLevel.Error };
    public insidersChannel: ExtensionChannels = 'off';
    public allowImportFromNotebook: boolean = false;
    public allowUnauthorizedRemoteConnection: boolean = false;
    public alwaysTrustNotebooks: boolean = false;
    public jupyterInterruptTimeout: number = 10_000;
    public jupyterLaunchTimeout: number = 60_000;
    public jupyterLaunchRetries: number = 3;
    public jupyterServerURI: string = 'local';
    public notebookFileRoot: string = '';
    public changeDirOnImportExport: boolean = false;
    public useDefaultConfigForJupyter: boolean = false;
    public searchForJupyter: boolean = false;
    public allowInput: boolean = false;
    public showCellInputCode: boolean = false;
    public collapseCellInputCodeByDefault: boolean = false;
    public maxOutputSize: number = -1;
    public enableScrollingForCellOutputs: boolean = false;
    public gatherToScript?: boolean | undefined;
    public gatherSpecPath?: string | undefined;
    public sendSelectionToInteractiveWindow: boolean = false;
    public markdownRegularExpression: string = '';
    public codeRegularExpression: string = '';
    public allowLiveShare?: boolean | undefined;
    public errorBackgroundColor: string = '';
    public ignoreVscodeTheme?: boolean | undefined;
    public variableExplorerExclude?: string | undefined;
    public liveShareConnectionTimeout?: number | undefined;
    public decorateCells?: boolean | undefined;
    public enableCellCodeLens?: boolean | undefined;
    public askForLargeDataFrames?: boolean | undefined;
    public enableAutoMoveToNextCell?: boolean | undefined;
    public askForKernelRestart?: boolean | undefined;
    public enablePlotViewer?: boolean | undefined;
    public codeLenses?: string | undefined;
    public debugCodeLenses?: string | undefined;
    public debugpyDistPath?: string | undefined;
    public stopOnFirstLineWhileDebugging?: boolean | undefined;
    public textOutputLimit?: number | undefined;
    public magicCommandsAsComments?: boolean | undefined;
    public stopOnError?: boolean | undefined;
    public remoteDebuggerPort?: number | undefined;
    public colorizeInputBox?: boolean | undefined;
    public addGotoCodeLenses?: boolean | undefined;
    public useNotebookEditor?: boolean | undefined;
    public runMagicCommands?: string | undefined;
    public runStartupCommands: string | string[] = [];
    public debugJustMyCode: boolean = false;
    public defaultCellMarker?: string | undefined;
    public verboseLogging?: boolean | undefined;
    public themeMatplotlibPlots?: boolean | undefined;
    public useWebViewServer?: boolean | undefined;
    public variableQueries: IVariableQuery[] = [];
    public disableJupyterAutoStart?: boolean | undefined;
    public jupyterCommandLineArguments: string[] = [];
    public widgetScriptSources: WidgetCDNs[] = [];
    public alwaysScrollOnNewCell?: boolean | undefined;
    public showKernelSelectionOnInteractiveWindow?: boolean | undefined;
    public interactiveWindowMode: InteractiveWindowMode = 'multiple';
    protected readonly changed = new EventEmitter<void>();
    private workspaceRoot: Resource;
    private disposables: Disposable[] = [];
    private readonly workspace: IWorkspaceService;

    constructor(workspaceFolder: Resource, workspace?: IWorkspaceService) {
        this.workspace = workspace || new WorkspaceService();
        this.workspaceRoot = workspaceFolder;
        this.initialize();
    }
    // tslint:disable-next-line:function-name
    public static getInstance(resource: Uri | undefined, workspace?: IWorkspaceService): JupyterSettings {
        workspace = workspace || new WorkspaceService();
        const workspaceFolderUri = JupyterSettings.getSettingsUriAndTarget(resource, workspace).uri;
        const workspaceFolderKey = workspaceFolderUri ? workspaceFolderUri.fsPath : '';

        if (!JupyterSettings.jupyterSettings.has(workspaceFolderKey)) {
            const settings = new JupyterSettings(workspaceFolderUri, workspace);
            JupyterSettings.jupyterSettings.set(workspaceFolderKey, settings);
        }
        // tslint:disable-next-line:no-non-null-assertion
        return JupyterSettings.jupyterSettings.get(workspaceFolderKey)!;
    }

    // tslint:disable-next-line:type-literal-delimiter
    public static getSettingsUriAndTarget(
        resource: Uri | undefined,
        workspace?: IWorkspaceService
    ): { uri: Uri | undefined; target: ConfigurationTarget } {
        workspace = workspace || new WorkspaceService();
        const workspaceFolder = resource ? workspace.getWorkspaceFolder(resource) : undefined;
        let workspaceFolderUri: Uri | undefined = workspaceFolder ? workspaceFolder.uri : undefined;

        if (!workspaceFolderUri && Array.isArray(workspace.workspaceFolders) && workspace.workspaceFolders.length > 0) {
            workspaceFolderUri = workspace.workspaceFolders[0].uri;
        }

        const target = workspaceFolderUri ? ConfigurationTarget.WorkspaceFolder : ConfigurationTarget.Global;
        return { uri: workspaceFolderUri, target };
    }

    // tslint:disable-next-line:function-name
    public static dispose() {
        if (!isTestExecution()) {
            throw new Error('Dispose can only be called from unit tests');
        }
        // tslint:disable-next-line:no-void-expression
        JupyterSettings.jupyterSettings.forEach((item) => item && item.dispose());
        JupyterSettings.jupyterSettings.clear();
    }
    public dispose() {
        // tslint:disable-next-line:no-unsafe-any
        this.disposables.forEach((disposable) => disposable && disposable.dispose());
        this.disposables = [];
    }
    // tslint:disable-next-line:cyclomatic-complexity max-func-body-length
    protected update(jupyterSettings: WorkspaceConfiguration) {
        const workspaceRoot = this.workspaceRoot?.fsPath;
        const systemVariables: SystemVariables = new SystemVariables(undefined, workspaceRoot, this.workspace);

        // tslint:disable-next-line: no-any
        const loggingSettings = systemVariables.resolveAny(jupyterSettings.get<any>('logging'))!;
        loggingSettings.level = convertSettingTypeToLogLevel(loggingSettings.level);
        if (this.logging) {
            Object.assign<ILoggingSettings, ILoggingSettings>(this.logging, loggingSettings);
        } else {
            this.logging = loggingSettings;
        }

        const experiments = systemVariables.resolveAny(jupyterSettings.get<IExperiments>('experiments'))!;
        if (this.experiments) {
            Object.assign<IExperiments, IExperiments>(this.experiments, experiments);
        } else {
            this.experiments = experiments;
        }
        this.experiments = this.experiments
            ? this.experiments
            : {
                  enabled: true,
                  optInto: [],
                  optOutFrom: []
              };

        // The rest are all the same.
        const keys = Object.getOwnPropertyNames(this).filter(
            (f) => f !== 'experiments' && f !== 'logging' && f !== 'languageServer'
        );
        keys.forEach((k) => {
            // Replace variables with their actual value.
            const val = systemVariables.resolveAny(jupyterSettings.get(k));
            // tslint:disable-next-line: no-any
            (<any>this)[k] = val;
        });
    }

    protected onWorkspaceFoldersChanged() {
        //If an activated workspace folder was removed, delete its key
        const workspaceKeys = this.workspace.workspaceFolders!.map((workspaceFolder) => workspaceFolder.uri.fsPath);
        const activatedWkspcKeys = Array.from(JupyterSettings.jupyterSettings.keys());
        const activatedWkspcFoldersRemoved = activatedWkspcKeys.filter((item) => workspaceKeys.indexOf(item) < 0);
        if (activatedWkspcFoldersRemoved.length > 0) {
            for (const folder of activatedWkspcFoldersRemoved) {
                JupyterSettings.jupyterSettings.delete(folder);
            }
        }
    }
    protected initialize(): void {
        const onDidChange = () => {
            const currentConfig = this.workspace.getConfiguration('jupyter', this.workspaceRoot);
            this.update(currentConfig);

            // If workspace config changes, then we could have a cascading effect of on change events.
            // Let's defer the change notification.
            this.debounceChangeNotification();
        };
        this.disposables.push(this.workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this));
        this.disposables.push(
            this.workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
                if (event.affectsConfiguration('jupyter')) {
                    onDidChange();
                }
            })
        );

        const initialConfig = this.workspace.getConfiguration('jupyter', this.workspaceRoot);
        if (initialConfig) {
            this.update(initialConfig);
        }
    }
    @debounceSync(1)
    protected debounceChangeNotification() {
        this.changed.fire();
    }
}

function convertSettingTypeToLogLevel(setting: LoggingLevelSettingType | undefined): LogLevel | 'off' {
    switch (setting) {
        case 'info': {
            return LogLevel.Info;
        }
        case 'warn': {
            return LogLevel.Warn;
        }
        case 'off': {
            return 'off';
        }
        case 'debug': {
            return LogLevel.Debug;
        }
        default: {
            return LogLevel.Error;
        }
    }
}
