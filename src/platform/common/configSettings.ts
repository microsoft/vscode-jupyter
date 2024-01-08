// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConfigurationChangeEvent,
    ConfigurationTarget,
    Disposable,
    Event,
    EventEmitter,
    Uri,
    WorkspaceConfiguration,
    workspace
} from 'vscode';
import { LogLevel } from '../logging/types';
import { isTestExecution } from './constants';
import {
    IExperiments,
    ILoggingSettings,
    InteractiveWindowMode,
    InteractiveWindowViewColumn,
    IWatchableJupyterSettings,
    LoggingLevelSettingType,
    Resource,
    WidgetCDNs
} from './types';
import { ISystemVariables, ISystemVariablesConstructor } from './variables/types';
import { ConfigMigration } from './configMigration';
import { noop } from './utils/misc';
import { debounce } from './decorators';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

// eslint-disable-next-line
/**
 * Typesafe representation of the settings in the jupyter extension.
 */
export class JupyterSettings implements IWatchableJupyterSettings {
    public get onDidChange(): Event<void> {
        return this._changeEmitter.event;
    }

    private static jupyterSettings: Map<string, JupyterSettings> = new Map<string, JupyterSettings>();
    public experiments!: IExperiments;
    public logging: ILoggingSettings = { level: 'error' };
    public allowUnauthorizedRemoteConnection: boolean = false;
    public jupyterInterruptTimeout: number = 10_000;
    public jupyterLaunchTimeout: number = 60_000;
    public jupyterLaunchRetries: number = 3;
    public notebookFileRoot: string = '';
    public useDefaultConfigForJupyter: boolean = false;
    public sendSelectionToInteractiveWindow: boolean = false;
    public normalizeSelectionForInteractiveWindow: boolean = true;
    public splitRunFileIntoCells: boolean = true;
    public markdownRegularExpression: string = '';
    public codeRegularExpression: string = '';
    public errorBackgroundColor: string = '';
    public variableExplorerExclude: string = '';
    public decorateCells: 'currentCell' | 'allCells' | 'disabled' = 'currentCell';
    public enableCellCodeLens: boolean = false;
    public askForLargeDataFrames: boolean = false;
    public enableAutoMoveToNextCell: boolean = false;
    public askForKernelRestart: boolean = false;
    public codeLenses: string = '';
    public debugCodeLenses: string = '';
    public debugpyDistPath: string = '';
    public stopOnFirstLineWhileDebugging: boolean = false;
    public magicCommandsAsComments: boolean = false;
    public pythonExportMethod: 'direct' | 'commentMagics' | 'nbconvert' = 'direct';
    public stopOnError: boolean = false;
    public addGotoCodeLenses: boolean = false;
    public runStartupCommands: string | string[] = [];
    public debugJustMyCode: boolean = false;
    public defaultCellMarker: string = '';
    public themeMatplotlibPlots: boolean = false;
    public disableJupyterAutoStart: boolean = false;
    public enablePythonKernelLogging: boolean = false;
    public jupyterCommandLineArguments: string[] = [];
    public widgetScriptSources: WidgetCDNs[] = [];
    public interactiveWindowMode: InteractiveWindowMode = 'multiple';
    public pythonCellFolding: boolean = true;
    public interactiveWindowViewColumn: InteractiveWindowViewColumn = 'secondGroup';
    // Hidden settings not surfaced in package.json
    public disableZMQSupport: boolean = false;
    // Hidden settings not surfaced in package.json
    public forceIPyKernelDebugger: boolean = false;
    public verboseLogging: boolean = false;
    public showVariableViewWhenDebugging: boolean = true;
    public newCellOnRunLast: boolean = true;
    public pythonCompletionTriggerCharacters: string = '';
    public logKernelOutputSeparately: boolean = false;
    public development: boolean = false;
    public poetryPath: string = '';
    public excludeUserSitePackages: boolean = false;
    public enableExtendedKernelCompletions: boolean = false;
    public formatStackTraces: boolean = false;
    // Privates should start with _ so that they are not read from the settings.json
    private _changeEmitter = new EventEmitter<void>();
    private _workspaceRoot: Resource;
    private _disposables: Disposable[] = [];

    constructor(
        workspaceFolder: Resource,
        private _systemVariablesCtor: ISystemVariablesConstructor, // Note: All properties not set with '_' are destroyed on update.
        private _type: 'node' | 'web'
    ) {
        this._workspaceRoot = workspaceFolder;
        this.initialize();
        // Disable auto start in untrusted workspaces.
        if (workspace.isTrusted === false) {
            this.disableJupyterAutoStart = true;
        }
    }

    public static getInstance(
        resource: Uri | undefined,
        systemVariablesCtor: ISystemVariablesConstructor,
        type: 'node' | 'web'
    ): JupyterSettings {
        const workspaceFolderUri = JupyterSettings.getSettingsUriAndTarget(resource).uri;
        const workspaceFolderKey = workspaceFolderUri ? workspaceFolderUri.path : '';

        let settings = JupyterSettings.jupyterSettings.get(workspaceFolderKey);
        if (!settings) {
            settings = new JupyterSettings(workspaceFolderUri, systemVariablesCtor, type);
            JupyterSettings.jupyterSettings.set(workspaceFolderKey, settings);
        } else if (settings._type === 'web' && type === 'node') {
            // Update to a node system variables if anybody every asks for a node one after
            // asking for a web one.
            settings._systemVariablesCtor = systemVariablesCtor;
            settings._type = type;
        }
        return settings;
    }

    public static getSettingsUriAndTarget(resource: Uri | undefined): {
        uri: Uri | undefined;
        target: ConfigurationTarget;
    } {
        const workspaceFolder = resource ? workspace.getWorkspaceFolder(resource) : undefined;
        let workspaceFolderUri: Uri | undefined = workspaceFolder ? workspaceFolder.uri : undefined;

        if (!workspaceFolderUri && Array.isArray(workspace.workspaceFolders) && workspace.workspaceFolders.length > 0) {
            workspaceFolderUri = workspace.workspaceFolders[0].uri;
        }

        const target = workspaceFolderUri ? ConfigurationTarget.WorkspaceFolder : ConfigurationTarget.Global;
        return { uri: workspaceFolderUri, target };
    }

    public static dispose() {
        if (!isTestExecution()) {
            throw new Error('Dispose can only be called from unit tests');
        }
        JupyterSettings.jupyterSettings.forEach((item) => item && item.dispose());
        JupyterSettings.jupyterSettings.clear();
    }
    public dispose() {
        this._disposables.forEach((disposable) => disposable && disposable.dispose());
        this._disposables = [];
    }

    public createSystemVariables(resource: Resource): ISystemVariables {
        return new this._systemVariablesCtor(resource, this._workspaceRoot);
    }

    public toJSON() {
        // Override this so settings can be turned into JSON without a circular problem

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = {};
        const allowedKeys = this.getSerializableKeys();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allowedKeys.forEach((k) => (result[k] = (<any>this)[k]));
        return result;
    }

    private update(jupyterConfig: WorkspaceConfiguration, pythonConfig: WorkspaceConfiguration | undefined) {
        const systemVariables = this.createSystemVariables(undefined);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loggingSettings = systemVariables.resolveAny(jupyterConfig.get<any>('logging'))!;
        if (loggingSettings) {
            loggingSettings.level = convertSettingTypeToLogLevel(loggingSettings.level);
            if (this.logging) {
                Object.assign<ILoggingSettings, ILoggingSettings>(this.logging, loggingSettings);
            } else {
                this.logging = loggingSettings;
            }
        }

        const experiments = systemVariables.resolveAny(jupyterConfig.get<IExperiments>('experiments'))!;
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
        const replacer = (k: string, config: WorkspaceConfiguration) => {
            const newKey = ConfigMigration.fullSettingIds[k];
            // Configuration migration is asyncronous, so check the old configuration key if the new one isn't set
            const configValue = newKey && config.get(newKey) !== undefined ? config.get(newKey) : config.get(k);
            const val = systemVariables.resolveAny(configValue);
            if (val !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (<any>this)[k] = val;
            }
        };
        const keys = this.getSerializableKeys().filter(
            (f) => f !== 'experiments' && f !== 'logging' && f !== 'kernelPickerType'
        );
        keys.forEach((k) => replacer(k, jupyterConfig));

        // Special case poetryPath. It actually comes from the python settings
        if (pythonConfig) {
            replacer('poetryPath', pythonConfig);
        }
    }

    private onWorkspaceFoldersChanged() {
        //If an activated workspace folder was removed, delete its key
        const workspaceKeys = (workspace.workspaceFolders || []).map((workspaceFolder) => workspaceFolder.uri.path);
        const activatedWkspcKeys = Array.from(JupyterSettings.jupyterSettings.keys());
        const activatedWkspcFoldersRemoved = activatedWkspcKeys.filter((item) => workspaceKeys.indexOf(item) < 0);
        if (activatedWkspcFoldersRemoved.length > 0) {
            for (const folder of activatedWkspcFoldersRemoved) {
                JupyterSettings.jupyterSettings.delete(folder);
            }
        }
    }

    private initialize(): void {
        const onDidChange = () => {
            const currentConfig = workspace.getConfiguration('jupyter', this._workspaceRoot);
            const pythonConfig = workspace.getConfiguration('python', this._workspaceRoot);
            this.update(currentConfig, pythonConfig);

            // If workspace config changes, then we could have a cascading effect of on change events.
            // Let's defer the change notification.
            this.debounceChangeNotification();
        };
        this._disposables.push(workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this));
        this._disposables.push(
            workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
                if (event.affectsConfiguration('jupyter')) {
                    onDidChange();
                }
                if (event.affectsConfiguration('python.poetryPath')) {
                    onDidChange();
                }
            })
        );

        const initialConfig = workspace.getConfiguration('jupyter', this._workspaceRoot);
        const pythonConfig = workspace.getConfiguration('python', this._workspaceRoot);
        if (initialConfig) {
            this.update(initialConfig, pythonConfig);
            this.migrateSettings(initialConfig).catch(noop);
        }
    }

    private async migrateSettings(config: WorkspaceConfiguration) {
        const configMigration = new ConfigMigration(config);
        await configMigration.migrateSettings();
    }

    @debounce(1)
    private debounceChangeNotification() {
        this._changeEmitter.fire();
    }

    protected fireChangeNotification() {
        this._changeEmitter.fire();
    }

    private getSerializableKeys() {
        // Get the keys that are allowed.
        return Object.getOwnPropertyNames(this).filter((f) => !f.startsWith('_'));
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
        case 'verbose': {
            return LogLevel.Trace;
        }
        default: {
            return LogLevel.Error;
        }
    }
}
