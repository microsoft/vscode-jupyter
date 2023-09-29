// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type * as nbformat from '@jupyterlab/nbformat';
import type WebSocketIsomorphic from 'isomorphic-ws';
import { Event } from 'vscode';
import { SemVer } from 'semver';
import { Uri } from 'vscode';
import { CancellationToken, Disposable } from 'vscode-jsonrpc';
import { IAsyncDisposable, ICell, IDisplayOptions, IDisposable, Resource } from '../../platform/common/types';
import { JupyterInstallError } from '../../platform/errors/jupyterInstallError';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import {
    KernelConnectionMetadata,
    IJupyterConnection,
    GetServerOptions,
    IKernelSocket,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelConnectionMetadata
} from '../types';
import { ClassType } from '../../platform/ioc/types';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../internalTypes';
import { IJupyterServerUri, IJupyterUriProvider, JupyterServerCollection, JupyterServerProvider } from '../../api';
import { IQuickPickItemProvider } from '../../platform/common/providerBasedQuickPick';

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

export interface IJupyterKernel {
    /**
     * Id of an existing (active) Kernel from an active session.
     *
     * @type {string}
     * @memberof IJupyterKernel
     */
    id?: string;
    name: string;
    lastActivityTime: Date | string;
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

export interface IInternalJupyterUriProvider extends IJupyterUriProvider {
    readonly extensionId: string;
}
export type JupyterServerProviderHandle = {
    /**
     * Jupyter Server Provider Id.
     */
    id: string;
    /**
     * Jupyter Server handle, unique for each server.
     */
    handle: string;
    /**
     * Extension that owns this server.
     */
    extensionId: string;
};

export const IJupyterUriProviderRegistration = Symbol('IJupyterUriProviderRegistration');

export interface IJupyterUriProviderRegistration {
    onDidChangeProviders: Event<void>;
    readonly providers: ReadonlyArray<IInternalJupyterUriProvider>;
    getProvider(extensionId: string, id: string): Promise<IInternalJupyterUriProvider | undefined>;
    registerProvider(provider: IJupyterUriProvider, extensionId: string): IDisposable;
    /**
     * Temporary, until the new API is finalized.
     * We need a way to get the displayName of the Server.
     */
    getDisplayNameIfProviderIsLoaded(providerHandle: JupyterServerProviderHandle): Promise<string | undefined>;
    getJupyterServerUri(
        serverHandle: JupyterServerProviderHandle,
        doNotPromptForAuthInfo?: boolean
    ): Promise<IJupyterServerUri>;
}

/**
 * Entry into our list of saved servers
 */
export interface IJupyterServerUriEntry {
    provider: JupyterServerProviderHandle;
    /**
     * The most recent time that we connected to this server
     */
    time: number;
    /**
     * An optional display name to show for this server as opposed to just the Uri
     * @deprecated Used only for migration of display names into the User Provided Server list. Else other providers will have the Display Names.
     */
    displayName?: string;
}

export const IJupyterServerUriStorage = Symbol('IJupyterServerUriStorage');
export interface IJupyterServerUriStorage {
    /**
     * Temporary event, the old API was async, the new API is sync.
     * However until we migrate everything we will never know whether
     * the data has been successfully loaded into memory.
     */
    readonly onDidLoad: Event<void>;
    readonly onDidChange: Event<void>;
    readonly onDidRemove: Event<JupyterServerProviderHandle[]>;
    readonly onDidAdd: Event<IJupyterServerUriEntry>;
    readonly all: readonly IJupyterServerUriEntry[];
    /**
     * Updates MRU list marking this server as the most recently used.
     */
    update(serverProviderHandle: JupyterServerProviderHandle): Promise<void>;
    /**
     * @deprecated Use `all` and `onDidLoad` instead.
     */
    getAll(): Promise<IJupyterServerUriEntry[]>;
    remove(serverProviderHandle: JupyterServerProviderHandle): Promise<void>;
    clear(): Promise<void>;
    add(serverProviderHandle: JupyterServerProviderHandle, options?: { time: number }): Promise<void>;
}

export interface IBackupFile {
    dispose: () => Promise<unknown>;
    filePath: string;
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
    getRequestCtor(cookieString?: string, allowUnauthorized?: boolean, getAuthHeader?: () => any): ClassType<Request>;
    getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response>;
    getHeadersCtor(): ClassType<Headers>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getWebsocketCtor(
        cookieString?: string,
        allowUnauthorized?: boolean,
        getAuthHeaders?: () => Record<string, string>,
        getWebSocketProtocols?: () => string | string[] | undefined
    ): ClassType<WebSocket>;
    wrapWebSocketCtor(websocketCtor: ClassType<WebSocketIsomorphic>): ClassType<WebSocketIsomorphic>;
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
    trackKernelIdAsUsed(resource: Uri, serverId: JupyterServerProviderHandle, kernelId: string): void;
    /**
     * Tracks the fact that the provided remote kernel for a given server is no longer used by a notebook defined by the uri.
     */
    trackKernelIdAsNotUsed(resource: Uri, serverId: JupyterServerProviderHandle, kernelId: string): void;
}

export const IJupyterRemoteCachedKernelValidator = Symbol('IJupyterRemoteCachedKernelValidator');
export interface IJupyterRemoteCachedKernelValidator {
    isValid(kernel: LiveRemoteKernelConnectionMetadata): Promise<boolean>;
}

export interface IRemoteKernelFinder
    extends IContributedKernelFinder<RemoteKernelConnectionMetadata>,
        IQuickPickItemProvider<RemoteKernelConnectionMetadata> {
    kind: ContributedKernelFinderKind.Remote;
    serverProviderHandle: JupyterServerProviderHandle;
}

export const IJupyterServerProviderRegistry = Symbol('IJupyterServerProviderRegistry');
export interface IJupyterServerProviderRegistry {
    onDidChangeCollections: Event<{ added: JupyterServerCollection[]; removed: JupyterServerCollection[] }>;
    readonly jupyterCollections: readonly JupyterServerCollection[];
    createJupyterServerCollection(
        extensionId: string,
        id: string,
        label: string,
        serverProvider: JupyterServerProvider
    ): JupyterServerCollection;
}
