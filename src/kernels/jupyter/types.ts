// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type * as nbformat from '@jupyterlab/nbformat';
import type { Kernel, Session } from '@jupyterlab/services';
import { Event } from 'vscode';
import { SemVer } from 'semver';
import { Uri, QuickPickItem } from 'vscode';
import { CancellationToken, Disposable } from 'vscode-jsonrpc';
import { JupyterCommands } from '../../platform/common/constants';
import { SpawnOptions, ExecutionResult, ObservableExecutionResult } from '../../platform/common/process/types';
import { IAsyncDisposable, ICell, IDisplayOptions, Resource } from '../../platform/common/types';
import { JupyterInstallError } from '../../platform/errors/jupyterInstallError';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import {
    KernelConnectionMetadata,
    INotebook,
    IJupyterConnection,
    ConnectNotebookProviderOptions,
    NotebookCreationOptions,
    IJupyterSession,
    IJupyterKernelSpec,
    GetServerOptions
} from '../types';
import { JupyterInterpreterDependencyResponse } from './interpreter/jupyterInterpreterDependencyService';
import { JupyterServerInfo } from './launcher/jupyterConnection';

// Talks to a jupyter ipython kernel to retrieve data for cells
export const INotebookServer = Symbol('INotebookServer');
export interface INotebookServer extends IAsyncDisposable {
    createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        cancelToken: CancellationToken,
        ui: IDisplayOptions
    ): Promise<INotebook>;
    connect(connection: IJupyterConnection, cancelToken: CancellationToken): Promise<void>;
    getConnectionInfo(): IJupyterConnection | undefined;
}

// Provides notebooks that talk to jupyter servers
export const IJupyterNotebookProvider = Symbol('IJupyterNotebookProvider');
export interface IJupyterNotebookProvider {
    connect(options: ConnectNotebookProviderOptions): Promise<IJupyterConnection | undefined>;
    createNotebook(options: NotebookCreationOptions): Promise<INotebook>;
}

export interface INotebookServerOptions {
    /**
     * Undefined when connecting to local Jupyter (in case Raw kernels aren't supported)
     */
    uri?: string;
    resource: Resource;
    skipUsingDefaultConfig?: boolean;
    workingDir?: string;
    ui: IDisplayOptions;
    /**
     * Whether we're only interested in local Jupyter Servers.
     */
    localJupyter: boolean;
}

export const IJupyterExecution = Symbol('IJupyterExecution');
export interface IJupyterExecution extends IAsyncDisposable {
    isNotebookSupported(cancelToken?: CancellationToken): Promise<boolean>;
    connectToNotebookServer(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer | undefined>;
    getUsableJupyterPython(cancelToken?: CancellationToken): Promise<PythonEnvironment | undefined>;
    getServer(options: INotebookServerOptions): Promise<INotebookServer | undefined>;
    getNotebookError(): Promise<string>;
    refreshCommands(): Promise<void>;
}

export interface IJupyterPasswordConnectInfo {
    requestHeaders?: HeadersInit;
    remappedBaseUrl?: string;
    remappedToken?: string;
}

export const IJupyterPasswordConnect = Symbol('IJupyterPasswordConnect');
export interface IJupyterPasswordConnect {
    getPasswordConnectionInfo(url: string): Promise<IJupyterPasswordConnectInfo | undefined>;
}

export const IJupyterSessionManagerFactory = Symbol('IJupyterSessionManagerFactory');
export interface IJupyterSessionManagerFactory {
    readonly onRestartSessionCreated: Event<Kernel.IKernelConnection>;
    readonly onRestartSessionUsed: Event<Kernel.IKernelConnection>;
    create(connInfo: IJupyterConnection, failOnPassword?: boolean): Promise<IJupyterSessionManager>;
}

export interface IJupyterSessionManager extends IAsyncDisposable {
    readonly onRestartSessionCreated: Event<Kernel.IKernelConnection>;
    readonly onRestartSessionUsed: Event<Kernel.IKernelConnection>;
    startNew(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        workingDirectory: string,
        ui: IDisplayOptions,
        cancelToken: CancellationToken
    ): Promise<IJupyterSession>;
    getKernelSpecs(): Promise<IJupyterKernelSpec[]>;
    getRunningKernels(): Promise<IJupyterKernel[]>;
    getRunningSessions(): Promise<Session.IModel[]>;
}

export interface IJupyterKernel {
    /**
     * Id of an existing (active) Kernel from an active session.
     *
     * @type {string}
     * @memberof IJupyterKernel
     */
    id?: string;
    name: string;
    lastActivityTime: Date;
    numberOfConnections: number;
}

export const INotebookImporter = Symbol('INotebookImporter');
export interface INotebookImporter extends Disposable {
    importFromFile(contentsFile: Uri, interpreter: PythonEnvironment): Promise<string>;
}

export const INotebookExporter = Symbol('INotebookExporter');
export interface INotebookExporter extends Disposable {
    translateToNotebook(
        cells: ICell[],
        directoryChange?: string,
        kernelSpec?: nbformat.IKernelspecMetadata
    ): Promise<nbformat.INotebookContent | undefined>;
    exportToFile(cells: ICell[], file: string, showOpenPrompt?: boolean): Promise<void>;
}

export interface IJupyterCommand {
    interpreter(): Promise<PythonEnvironment | undefined>;
    exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>>;
}

export const IJupyterCommandFactory = Symbol('IJupyterCommandFactory');
export interface IJupyterCommandFactory {
    createInterpreterCommand(
        command: JupyterCommands,
        moduleName: string,
        args: string[],
        interpreter: PythonEnvironment,
        isActiveInterpreter: boolean
    ): IJupyterCommand;
}

export const IJupyterSubCommandExecutionService = Symbol('IJupyterSubCommandExecutionService');
/**
 * Responsible for execution of jupyter subcommands such as `notebook`, `nbconvert`, etc.
 * The executed code is as follows `python -m jupyter <subcommand>`.
 *
 * @export
 * @interface IJupyterSubCommandExecutionService
 */
export interface IJupyterSubCommandExecutionService {
    /**
     * Checks whether notebook is supported.
     *
     * @param {CancellationToken} [cancelToken]
     * @returns {Promise<boolean>}
     * @memberof IJupyterSubCommandExecutionService
     */
    isNotebookSupported(cancelToken?: CancellationToken): Promise<boolean>;
    /**
     * Error message indicating why jupyter notebook isn't supported.
     *
     * @returns {Promise<string>}
     * @memberof IJupyterSubCommandExecutionService
     */
    getReasonForJupyterNotebookNotBeingSupported(): Promise<string>;
    /**
     * Used to refresh the command finder.
     *
     * @returns {Promise<void>}
     * @memberof IJupyterSubCommandExecutionService
     */
    refreshCommands(): Promise<void>;
    /**
     * Gets the interpreter to be used for starting of jupyter server.
     *
     * @param {CancellationToken} [token]
     * @returns {(Promise<PythonEnvironment | undefined>)}
     * @memberof IJupyterInterpreterService
     */
    getSelectedInterpreter(token?: CancellationToken): Promise<PythonEnvironment | undefined>;
    /**
     * Starts the jupyter notebook server
     *
     * @param {string[]} notebookArgs
     * @param {SpawnOptions} options
     * @returns {Promise<ObservableExecutionResult<string>>}
     * @memberof IJupyterSubCommandExecutionService
     */
    startNotebook(notebookArgs: string[], options: SpawnOptions): Promise<ObservableExecutionResult<string>>;
    /**
     * Gets a list of all locally running jupyter notebook servers.
     *
     * @param {CancellationToken} [token]
     * @returns {(Promise<JupyterServerInfo[] | undefined>)}
     * @memberof IJupyterSubCommandExecutionService
     */
    getRunningJupyterServers(token?: CancellationToken): Promise<JupyterServerInfo[] | undefined>;
}

export const IJupyterInterpreterDependencyManager = Symbol('IJupyterInterpreterDependencyManager');
export interface IJupyterInterpreterDependencyManager {
    /**
     * Installs the dependencies required to launch jupyter.
     *
     * @param {JupyterInstallError} [err]
     * @returns {Promise<void>}
     * @memberof IJupyterInterpreterDependencyManager
     */
    installMissingDependencies(err?: JupyterInstallError): Promise<JupyterInterpreterDependencyResponse>;
}

export const INbConvertInterpreterDependencyChecker = Symbol('INbConvertInterpreterDependencyChecker');
export interface INbConvertInterpreterDependencyChecker {
    isNbConvertInstalled(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean>;
    getNbConvertVersion(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<SemVer | undefined>;
}

export const INbConvertExportToPythonService = Symbol('INbConvertExportToPythonService');
export interface INbConvertExportToPythonService {
    exportNotebookToPython(
        file: Uri,
        interpreter: PythonEnvironment,
        template?: string,
        token?: CancellationToken
    ): Promise<string>;
}

export const IJupyterServerProvider = Symbol('IJupyterServerProvider');
export interface IJupyterServerProvider {
    /**
     * Gets the server used for starting notebooks
     */
    getOrCreateServer(options: GetServerOptions): Promise<INotebookServer | undefined>;
}

export interface IJupyterServerUri {
    baseUrl: string;
    token: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authorizationHeader: any; // JSON object for authorization header.
    expiration?: Date; // Date/time when header expires and should be refreshed.
    displayName: string;
}

export type JupyterServerUriHandle = string;

export interface IJupyterUriProvider {
    readonly id: string; // Should be a unique string (like a guid)
    getQuickPickEntryItems(): QuickPickItem[];
    handleQuickPick(item: QuickPickItem, backEnabled: boolean): Promise<JupyterServerUriHandle | 'back' | undefined>;
    getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
}

export const IJupyterUriProviderRegistration = Symbol('IJupyterUriProviderRegistration');

export interface IJupyterUriProviderRegistration {
    getProviders(): Promise<ReadonlyArray<IJupyterUriProvider>>;
    registerProvider(picker: IJupyterUriProvider): void;
    getJupyterServerUri(id: string, handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
}

export const IJupyterServerUriStorage = Symbol('IJupyterServerUriStorage');
export interface IJupyterServerUriStorage {
    readonly onDidChangeUri: Event<void>;
    addToUriList(uri: string, time: number, displayName: string): Promise<void>;
    getSavedUriList(): Promise<{ uri: string; time: number; displayName?: string }[]>;
    removeUri(uri: string): Promise<void>;
    clearUriList(): Promise<void>;
    getUri(): Promise<string>;
    setUri(uri: string): Promise<void>;
}
