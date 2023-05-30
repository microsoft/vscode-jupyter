// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type * as nbformat from '@jupyterlab/nbformat';
import type { Session, ContentsManager, ServerConnection } from '@jupyterlab/services';
import { Event } from 'vscode';
import { SemVer } from 'semver';
import { Uri, QuickPickItem } from 'vscode';
import { CancellationToken, Disposable } from 'vscode-jsonrpc';
import { IAsyncDisposable, ICell, IDisplayOptions, IDisposable, Resource } from '../../platform/common/types';
import { JupyterInstallError } from '../../platform/errors/jupyterInstallError';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import {
    KernelConnectionMetadata,
    IJupyterConnection,
    IJupyterKernelSession,
    IJupyterKernelSpec,
    GetServerOptions,
    IKernelSocket,
    KernelActionSource,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelConnectionMetadata
} from '../types';
import { ClassType } from '../../platform/ioc/types';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../internalTypes';

export type JupyterServerInfo = {
    base_url: string;
    notebook_dir: string;
    hostname: string;
    password: boolean;
    pid: number;
    port: number;
    secure: boolean;
    token: string;
    url: string;
};

export enum JupyterInterpreterDependencyResponse {
    ok,
    selectAnotherInterpreter,
    cancel
}

export const IJupyterServerHelper = Symbol('JupyterServerHelper');
export interface IJupyterServerHelper extends IAsyncDisposable {
    isJupyterServerSupported(cancelToken?: CancellationToken): Promise<boolean>;
    startServer(resource: Resource, cancelToken?: CancellationToken): Promise<IJupyterConnection>;
    getUsableJupyterPython(cancelToken?: CancellationToken): Promise<PythonEnvironment | undefined>;
    getJupyterServerError(): Promise<string>;
    refreshCommands(): Promise<void>;
}

export const IJupyterSessionManagerFactory = Symbol('IJupyterSessionManagerFactory');
export interface IJupyterSessionManagerFactory {
    create(connInfo: IJupyterConnection, settings: ServerConnection.ISettings): IJupyterSessionManager;
}

export interface IJupyterSessionManager extends IAsyncDisposable {
    readonly isDisposed: boolean;
    startNew(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        workingDirectory: Uri,
        ui: IDisplayOptions,
        cancelToken: CancellationToken,
        creator: KernelActionSource
    ): Promise<IJupyterKernelSession>;
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
        kernelSpec?: nbformat.IKernelspecMetadata
    ): Promise<nbformat.INotebookContent | undefined>;
    exportToFile(cells: ICell[], file: string, showOpenPrompt?: boolean): Promise<void>;
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
/**
 * Provides a wrapper around a local Jupyter Notebook Server.
 */
export interface IJupyterServerProvider {
    /**
     * Stats the local Jupyter Notebook server (if not already started)
     * and returns the connection information.
     */
    getOrStartServer(options: GetServerOptions): Promise<IJupyterConnection>;
}

export interface IJupyterServerUri {
    baseUrl: string;
    /**
     * Jupyter auth Token
     */
    token: string;
    /**
     * Authorization header to be used when connecting to the server.
     */
    authorizationHeader?: Record<string, string>;
    displayName: string;
    /**
     * The local directory that maps to the remote directory of the Jupyter Server.
     * E.g. assume you start Jupyter Notebook with --notebook-dir=/foo/bar,
     * and you have a file named /foo/bar/sample.ipynb, /foo/bar/sample2.ipynb and the like.
     * Then assume the mapped local directory will be /users/xyz/remoteServer and the files sample.ipynb and sample2.ipynb
     * are in the above local directory.
     *
     * Using this setting one can map the local directory to the remote directory.
     * In this case the value of this property would be /users/xyz/remoteServer.
     *
     * Note: A side effect of providing this value is the fact that Session names are generated the way they are in Jupyter Notebook/Lab.
     * I.e. the session names map to the relative path of the notebook file.
     * As a result when attempting to create a new session for a notebook/file, Jupyter will
     * first check if a session already exists for the same file and same kernel, and if so, will re-use that session.
     */
    mappedRemoteNotebookDir?: string;
    /**
     * Returns the sub-protocols to be used. See details of `protocols` here https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
     */
    webSocketProtocols?: string[];
}

export type JupyterServerProviderHandle = {
    extensionId: string;
    /**
     * Jupyter Server Provider Id.
     */
    id: string;
    /**
     * Jupyter Server handle, unique for each server.
     */
    handle: string;
};
export interface IJupyterUriProvider {
    /**
     * Should be a unique string (like a guid)
     */
    readonly id: string;
    readonly extensionId: string;
    readonly displayName?: string;
    readonly detail?: string;
    onDidChangeHandles?: Event<void>;
    getQuickPickEntryItems?():
        | Promise<
              (QuickPickItem & {
                  /**
                   * If this is the only quick pick item in the list and this is true, then this item will be selected by default.
                   */
                  default?: boolean;
              })[]
          >
        | (QuickPickItem & {
              /**
               * If this is the only quick pick item in the list and this is true, then this item will be selected by default.
               */
              default?: boolean;
          })[];
    handleQuickPick?(item: QuickPickItem, backEnabled: boolean): Promise<string | 'back' | undefined>;
    /**
     * Given the handle, returns the Jupyter Server information.
     */
    getServerUri(handle: string): Promise<IJupyterServerUri>;
    /**
     * Gets a list of all valid Jupyter Server handles that can be passed into the `getServerUri` method.
     */
    getHandles?(): Promise<string[]>;
    /**
     * Users request to remove a handle.
     */
    removeHandle?(handle: string): Promise<void>;
}

export const IJupyterUriProviderRegistration = Symbol('IJupyterUriProviderRegistration');

export interface IJupyterUriProviderRegistration {
    onDidChangeProviders: Event<void>;
    /**
     * Calling `getJupyterServerUri` just to get the display name could have unnecessary side effects.
     * E.g. we could end up connecting to a remote server or prompting for username/password, etc.
     * This will just return the display name if we have one, or if previously cached.
     */
    getDisplayName(serverHandle: JupyterServerProviderHandle): Promise<string>;
    getProviders(): Promise<ReadonlyArray<IJupyterUriProvider>>;
    getProvider(id: string): Promise<IJupyterUriProvider | undefined>;
    registerProvider(picker: IJupyterUriProvider): IDisposable;
    getJupyterServerUri(serverHandle: JupyterServerProviderHandle): Promise<IJupyterServerUri>;
}

/**
 * Entry into our list of saved servers
 */
export interface IJupyterServerUriEntry {
    /**
     * Uri of the server to connect to
     * @deprecated
     */
    uri?: string;
    serverHandle: JupyterServerProviderHandle;
    /**
     * The most recent time that we connected to this server
     */
    time: number;
    /**
     * An optional display name to show for this server as opposed to just the Uri
     */
    displayName?: string;
    /**
     * Whether the server is validated by its provider or not
     */
    isValidated?: boolean;
}

export const IJupyterServerUriStorage = Symbol('IJupyterServerUriStorage');
export interface IJupyterServerUriStorage {
    readonly onDidChange: Event<void>;
    readonly onDidRemove: Event<IJupyterServerUriEntry[]>;
    readonly onDidAdd: Event<IJupyterServerUriEntry>;
    /**
     * Updates MRU list marking this server as the most recently used.
     */
    update(serverHandle: JupyterServerProviderHandle): Promise<void>;
    getAll(): Promise<IJupyterServerUriEntry[]>;
    remove(serverHandle: JupyterServerProviderHandle): Promise<void>;
    clear(): Promise<void>;
    get(serverHandle: JupyterServerProviderHandle): Promise<IJupyterServerUriEntry | undefined>;
    add(serverHandle: JupyterServerProviderHandle): Promise<void>;
}

export interface IBackupFile {
    dispose: () => Promise<unknown>;
    filePath: string;
}

export const IJupyterBackingFileCreator = Symbol('IJupyterBackingFileCreator');
export interface IJupyterBackingFileCreator {
    createBackingFile(
        resource: Resource,
        workingDirectory: Uri,
        kernel: KernelConnectionMetadata,
        connInfo: IJupyterConnection,
        contentsManager: ContentsManager
    ): Promise<IBackupFile | undefined>;
}

export const IJupyterKernelService = Symbol('IJupyterKernelService');
export interface IJupyterKernelService {
    ensureKernelIsUsable(
        resource: Resource,
        kernel: KernelConnectionMetadata,
        ui: IDisplayOptions,
        cancelToken: CancellationToken,
        cannotChangeKernels?: boolean
    ): Promise<void>;
}

export const IJupyterRequestAgentCreator = Symbol('IJupyterRequestAgentCreator');
export interface IJupyterRequestAgentCreator {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createHttpRequestAgent(): any;
}

export const IJupyterRequestCreator = Symbol('IJupyterRequestCreator');
export interface IJupyterRequestCreator {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getRequestCtor(allowUnauthorized?: boolean, getAuthHeader?: () => Record<string, string>): ClassType<Request>;
    getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response>;
    getHeadersCtor(): ClassType<Headers>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getWebsocketCtor(
        allowUnauthorized?: boolean,
        getAuthHeaders?: () => Record<string, string>,
        getWebSocketProtocols?: () => string | string[] | undefined
    ): typeof WebSocket;
    getWebsocket(id: string): IKernelSocket | undefined;
    getRequestInit(): RequestInit;
}

export const INotebookStarter = Symbol('INotebookStarter');
export interface INotebookStarter extends IDisposable {
    start(
        resource: Resource,
        useDefaultConfig: boolean,
        customCommandLine: string[],
        workingDirectory: Uri,
        cancelToken: CancellationToken
    ): Promise<IJupyterConnection>;
}

export const ILiveRemoteKernelConnectionUsageTracker = Symbol('ILiveRemoteKernelConnectionUsageTracker');
export interface ILiveRemoteKernelConnectionUsageTracker {
    /**
     * Whether the provided remote kernel was ever used by any notebook within the extension.
     */
    wasKernelUsed(connection: LiveRemoteKernelConnectionMetadata): boolean;
    /**
     * Tracks the fact that the provided remote kernel for a given server was used by a notebook defined by the uri.
     */
    trackKernelIdAsUsed(resource: Uri, serverHandle: JupyterServerProviderHandle, kernelId: string): void;
    /**
     * Tracks the fact that the provided remote kernel for a given server is no longer used by a notebook defined by the uri.
     */
    trackKernelIdAsNotUsed(resource: Uri, serverHandle: JupyterServerProviderHandle, kernelId: string): void;
}

export const IJupyterRemoteCachedKernelValidator = Symbol('IJupyterRemoteCachedKernelValidator');
export interface IJupyterRemoteCachedKernelValidator {
    isValid(kernel: LiveRemoteKernelConnectionMetadata): Promise<boolean>;
}

export interface IRemoteKernelFinder extends IContributedKernelFinder<RemoteKernelConnectionMetadata> {
    kind: ContributedKernelFinderKind.Remote;
    serverUri: IJupyterServerUriEntry;
}
