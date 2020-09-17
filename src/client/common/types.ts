// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { Socket } from 'net';
import { Request as RequestResult } from 'request';
import {
    CancellationToken,
    ConfigurationTarget,
    Disposable,
    Event,
    Extension,
    ExtensionContext,
    OutputChannel,
    Uri,
    WorkspaceEdit
} from 'vscode';
import { LogLevel } from '../logging/levels';
import { CommandsWithoutArgs } from './application/commands';
import { ExtensionChannels } from './insidersBuild/types';
import { InterpreterUri } from './installer/types';
import { EnvironmentVariables } from './variables/types';
export const IOutputChannel = Symbol('IOutputChannel');
export interface IOutputChannel extends OutputChannel {}
export const IsWindows = Symbol('IS_WINDOWS');
export const IDisposableRegistry = Symbol('IDisposableRegistry');
export type IDisposableRegistry = Disposable[];
export const IMemento = Symbol('IGlobalMemento');
export const GLOBAL_MEMENTO = Symbol('IGlobalMemento');
export const WORKSPACE_MEMENTO = Symbol('IWorkspaceMemento');

export type Resource = Uri | undefined;
export interface IPersistentState<T> {
    readonly value: T;
    updateValue(value: T): Promise<void>;
}
export type Version = {
    raw: string;
    major: number;
    minor: number;
    patch: number;
    build: string[];
    prerelease: string[];
};

export type ReadWrite<T> = {
    -readonly [P in keyof T]: T[P];
};

export const IPersistentStateFactory = Symbol('IPersistentStateFactory');

export interface IPersistentStateFactory {
    createGlobalPersistentState<T>(key: string, defaultValue?: T, expiryDurationMs?: number): IPersistentState<T>;
    createWorkspacePersistentState<T>(key: string, defaultValue?: T, expiryDurationMs?: number): IPersistentState<T>;
}

export type ExecutionInfo = {
    execPath?: string;
    moduleName?: string;
    args: string[];
    product?: Product;
};

export enum InstallerResponse {
    Installed,
    Disabled,
    Ignore
}

export enum Product {
    jupyter = 18,
    ipykernel = 19,
    notebook = 20,
    kernelspec = 21,
    nbconvert = 22,
    pandas = 23
}

export enum ModuleNamePurpose {
    install = 1,
    run = 2
}

export const IInstaller = Symbol('IInstaller');

export interface IInstaller {
    promptToInstall(
        product: Product,
        resource?: InterpreterUri,
        cancel?: CancellationToken
    ): Promise<InstallerResponse>;
    install(product: Product, resource?: InterpreterUri, cancel?: CancellationToken): Promise<InstallerResponse>;
    isInstalled(product: Product, resource?: InterpreterUri): Promise<boolean | undefined>;
    translateProductToModuleName(product: Product, purpose: ModuleNamePurpose): string;
}

// tslint:disable-next-line:no-suspicious-comment
// TODO: Drop IPathUtils in favor of IFileSystemPathUtils.
// See https://github.com/microsoft/vscode-python/issues/8542.
export const IPathUtils = Symbol('IPathUtils');
export interface IPathUtils {
    readonly delimiter: string;
    readonly home: string;
    /**
     * The platform-specific file separator. '\\' or '/'.
     * @type {string}
     * @memberof IPathUtils
     */
    readonly separator: string;
    getPathVariableName(): 'Path' | 'PATH';
    basename(pathValue: string, ext?: string): string;
    getDisplayName(pathValue: string, cwd?: string): string;
}

export const IRandom = Symbol('IRandom');
export interface IRandom {
    getRandomInt(min?: number, max?: number): number;
}

export const ICurrentProcess = Symbol('ICurrentProcess');
export interface ICurrentProcess {
    readonly env: EnvironmentVariables;
    readonly argv: string[];
    readonly stdout: NodeJS.WriteStream;
    readonly stdin: NodeJS.ReadStream;
    readonly execPath: string;
    on(event: string | symbol, listener: Function): this;
}

export interface IJupyterSettings {
    readonly insidersChannel: ExtensionChannels;
    readonly experiments: IExperiments;
    readonly logging: ILoggingSettings;
    readonly allowUnauthorizedRemoteConnection: boolean;
    readonly allowImportFromNotebook: boolean;
    readonly alwaysTrustNotebooks: boolean;
    readonly jupyterInterruptTimeout: number;
    readonly jupyterLaunchTimeout: number;
    readonly jupyterLaunchRetries: number;
    readonly jupyterServerURI: string;
    readonly notebookFileRoot: string;
    readonly changeDirOnImportExport: boolean;
    readonly useDefaultConfigForJupyter: boolean;
    readonly searchForJupyter: boolean;
    readonly allowInput: boolean;
    readonly showCellInputCode: boolean;
    readonly collapseCellInputCodeByDefault: boolean;
    readonly maxOutputSize: number;
    readonly enableScrollingForCellOutputs: boolean;
    readonly gatherToScript: boolean;
    readonly gatherSpecPath: string;
    readonly sendSelectionToInteractiveWindow: boolean;
    readonly markdownRegularExpression: string;
    readonly codeRegularExpression: string;
    readonly allowLiveShare: boolean;
    readonly errorBackgroundColor: string;
    readonly ignoreVscodeTheme: boolean;
    readonly variableExplorerExclude: string;
    readonly liveShareConnectionTimeout: number;
    readonly decorateCells: boolean;
    readonly enableCellCodeLens: boolean;
    readonly askForLargeDataFrames: boolean;
    readonly enableAutoMoveToNextCell: boolean;
    readonly askForKernelRestart: boolean;
    readonly enablePlotViewer: boolean;
    readonly codeLenses: string;
    readonly debugCodeLenses: string;
    readonly debugpyDistPath: string;
    readonly stopOnFirstLineWhileDebugging: boolean;
    readonly textOutputLimit: number;
    readonly magicCommandsAsComments: boolean;
    readonly stopOnError: boolean;
    readonly remoteDebuggerPort: number;
    readonly colorizeInputBox: boolean;
    readonly addGotoCodeLenses: boolean;
    readonly useNotebookEditor: boolean;
    readonly runMagicCommands: string;
    readonly runStartupCommands: string | string[];
    readonly debugJustMyCode: boolean;
    readonly defaultCellMarker: string;
    readonly verboseLogging: boolean;
    readonly themeMatplotlibPlots: boolean;
    readonly useWebViewServer: boolean;
    readonly variableQueries: IVariableQuery[];
    readonly disableJupyterAutoStart: boolean;
    readonly jupyterCommandLineArguments: string[];
    readonly widgetScriptSources: WidgetCDNs[];
    readonly alwaysScrollOnNewCell: boolean;
    readonly showKernelSelectionOnInteractiveWindow: boolean;
    readonly interactiveWindowMode: InteractiveWindowMode;
}

export interface IWatchableJupyterSettings extends IJupyterSettings {
    readonly onDidChange: Event<void>;
}

export type LoggingLevelSettingType = 'off' | 'error' | 'warn' | 'info' | 'debug';

export interface ILoggingSettings {
    readonly level: LogLevel | 'off';
}

export interface IExperiments {
    /**
     * Return `true` if experiments are enabled, else `false`.
     */
    readonly enabled: boolean;
    /**
     * Experiments user requested to opt into manually
     */
    readonly optInto: string[];
    /**
     * Experiments user requested to opt out from manually
     */
    readonly optOutFrom: string[];
}

export enum AnalysisSettingsLogLevel {
    Information = 'Information',
    Error = 'Error',
    Warning = 'Warning'
}

export type LanguageServerDownloadChannels = 'stable' | 'beta' | 'daily';
export interface IAnalysisSettings {
    readonly downloadChannel?: LanguageServerDownloadChannels;
    readonly typeshedPaths: string[];
    readonly cacheFolderPath: string | null;
    readonly errors: string[];
    readonly warnings: string[];
    readonly information: string[];
    readonly disabled: string[];
    readonly traceLogging: boolean;
    readonly logLevel: AnalysisSettingsLogLevel;
}

export interface IVariableQuery {
    language: string;
    query: string;
    parseExpr: string;
}

export type InteractiveWindowMode = 'perFile' | 'single' | 'multiple';

export type WidgetCDNs = 'unpkg.com' | 'jsdelivr.com';

export const IConfigurationService = Symbol('IConfigurationService');
export interface IConfigurationService {
    getSettings(resource?: Uri): IWatchableJupyterSettings;
    isTestExecution(): boolean;
    updateSetting(setting: string, value?: {}, resource?: Uri, configTarget?: ConfigurationTarget): Promise<void>;
    updateSectionSetting(
        section: string,
        setting: string,
        value?: {},
        resource?: Uri,
        configTarget?: ConfigurationTarget
    ): Promise<void>;
}

export const ISocketServer = Symbol('ISocketServer');
export interface ISocketServer extends Disposable {
    readonly client: Promise<Socket>;
    Start(options?: { port?: number; host?: string }): Promise<number>;
}

export type DownloadOptions = {
    /**
     * Prefix for progress messages displayed.
     *
     * @type {('Downloading ... ' | string)}
     */
    progressMessagePrefix: 'Downloading ... ' | string;
    /**
     * Output panel into which progress information is written.
     *
     * @type {IOutputChannel}
     */
    outputChannel?: IOutputChannel;
    /**
     * Extension of file that'll be created when downloading the file.
     *
     * @type {('tmp' | string)}
     */
    extension: 'tmp' | string;
};

export const IFileDownloader = Symbol('IFileDownloader');
/**
 * File downloader, that'll display progress in the status bar.
 *
 * @export
 * @interface IFileDownloader
 */
export interface IFileDownloader {
    /**
     * Download file and display progress in statusbar.
     * Optionnally display progress in the provided output channel.
     *
     * @param {string} uri
     * @param {DownloadOptions} options
     * @returns {Promise<string>}
     * @memberof IFileDownloader
     */
    downloadFile(uri: string, options: DownloadOptions): Promise<string>;
}

export const IHttpClient = Symbol('IHttpClient');
export interface IHttpClient {
    downloadFile(uri: string): Promise<RequestResult>;
    /**
     * Downloads file from uri as string and parses them into JSON objects
     * @param uri The uri to download the JSON from
     * @param strict Set `false` to allow trailing comma and comments in the JSON, defaults to `true`
     */
    getJSON<T>(uri: string, strict?: boolean): Promise<T>;
    /**
     * Returns the url is valid (i.e. return status code of 200).
     */
    exists(uri: string): Promise<boolean>;
}

export const IExtensionContext = Symbol('ExtensionContext');
export interface IExtensionContext extends ExtensionContext {}

export const IExtensions = Symbol('IExtensions');
export interface IExtensions {
    /**
     * All extensions currently known to the system.
     */
    // tslint:disable-next-line:no-any
    readonly all: readonly Extension<any>[];

    /**
     * An event which fires when `extensions.all` changes. This can happen when extensions are
     * installed, uninstalled, enabled or disabled.
     */
    readonly onDidChange: Event<void>;

    /**
     * Get an extension by its full identifier in the form of: `publisher.name`.
     *
     * @param extensionId An extension identifier.
     * @return An extension or `undefined`.
     */
    // tslint:disable-next-line:no-any
    getExtension(extensionId: string): Extension<any> | undefined;

    /**
     * Get an extension its full identifier in the form of: `publisher.name`.
     *
     * @param extensionId An extension identifier.
     * @return An extension or `undefined`.
     */
    getExtension<T>(extensionId: string): Extension<T> | undefined;
}

export const IBrowserService = Symbol('IBrowserService');
export interface IBrowserService {
    launch(url: string): void;
}

export const IPythonExtensionBanner = Symbol('IPythonExtensionBanner');
export interface IPythonExtensionBanner {
    readonly enabled: boolean;
    showBanner(): Promise<void>;
}
export const BANNER_NAME_PROPOSE_LS: string = 'ProposePylance';
export const BANNER_NAME_DS_SURVEY: string = 'DSSurveyBanner';
export const BANNER_NAME_INTERACTIVE_SHIFTENTER: string = 'InteractiveShiftEnterBanner';

export type DeprecatedSettingAndValue = {
    setting: string;
    values?: {}[];
};

export type DeprecatedFeatureInfo = {
    doNotDisplayPromptStateKey: string;
    message: string;
    moreInfoUrl: string;
    commands?: CommandsWithoutArgs[];
    setting?: DeprecatedSettingAndValue;
};

export const IFeatureDeprecationManager = Symbol('IFeatureDeprecationManager');

export interface IFeatureDeprecationManager extends Disposable {
    initialize(): void;
    registerDeprecation(deprecatedInfo: DeprecatedFeatureInfo): void;
}

export const IEditorUtils = Symbol('IEditorUtils');
export interface IEditorUtils {
    getWorkspaceEditsFromPatch(originalContents: string, patch: string, uri: Uri): WorkspaceEdit;
}

export interface IDisposable {
    dispose(): void | undefined;
}
export interface IAsyncDisposable {
    dispose(): Promise<void>;
}

/**
 * Stores hash formats
 */
export interface IHashFormat {
    number: number; // If hash format is a number
    string: string; // If hash format is a string
}

/**
 * Interface used to implement cryptography tools
 */
export const ICryptoUtils = Symbol('ICryptoUtils');
export interface ICryptoUtils {
    /**
     * Creates hash using the data and encoding specified
     * @returns hash as number, or string
     * @param data The string to hash
     * @param hashFormat Return format of the hash, number or string
     * @param [algorithm]
     */
    createHash<E extends keyof IHashFormat>(
        data: string,
        hashFormat: E,
        algorithm?: 'SHA512' | 'SHA256' | 'FNV'
    ): IHashFormat[E];
}

export const IAsyncDisposableRegistry = Symbol('IAsyncDisposableRegistry');
export interface IAsyncDisposableRegistry extends IAsyncDisposable {
    push(disposable: IDisposable | IAsyncDisposable): void;
}

/* ABExperiments field carries the identity, and the range of the experiment,
 where the experiment is valid for users falling between the number 'min' and 'max'
 More details: https://en.wikipedia.org/wiki/A/B_testing
*/
export type ABExperiments = {
    name: string; // Name of the experiment
    salt: string; // Salt string for the experiment
    min: number; // Lower limit for the experiment
    max: number; // Upper limit for the experiment
}[];

/**
 * Interface used to implement AB testing
 */
export const IExperimentsManager = Symbol('IExperimentsManager');
export interface IExperimentsManager {
    /**
     * Checks if experiments are enabled, sets required environment to be used for the experiments, logs experiment groups
     */
    activate(): Promise<void>;

    /**
     * Checks if user is in experiment or not
     * @param experimentName Name of the experiment
     * @returns `true` if user is in experiment, `false` if user is not in experiment
     */
    inExperiment(experimentName: string): boolean;

    /**
     * Sends experiment telemetry if user is in experiment
     * @param experimentName Name of the experiment
     */
    sendTelemetryIfInExperiment(experimentName: string): void;
}

/**
 * Experiment service leveraging VS Code's experiment framework.
 */
export const IExperimentService = Symbol('IExperimentService');
export interface IExperimentService {
    inExperiment(experimentName: string): Promise<boolean>;
    getExperimentValue<T extends boolean | number | string>(experimentName: string): Promise<T | undefined>;
}

export type InterpreterConfigurationScope = { uri: Resource; configTarget: ConfigurationTarget };
export type InspectInterpreterSettingType = {
    globalValue?: string;
    workspaceValue?: string;
    workspaceFolderValue?: string;
};
