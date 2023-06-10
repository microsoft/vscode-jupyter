// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type * as nbformat from '@jupyterlab/nbformat';
import type { Session } from '@jupyterlab/services';
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
    IJupyterKernelSpec,
    GetServerOptions,
    IKernelSocket,
    LiveRemoteKernelConnectionMetadata,
    RemoteKernelConnectionMetadata
} from '../types';
import { ClassType } from '../../platform/ioc/types';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../internalTypes';
import { IJupyterServerUri, IJupyterUriProvider } from '../../api';

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
export interface IJupyterLabHelper extends IAsyncDisposable {
    readonly isDisposed: boolean;
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

export interface IInternalJupyterUriProvider extends IJupyterUriProvider {
    readonly extensionId: string;
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

export const IJupyterUriProviderRegistration = Symbol('IJupyterUriProviderRegistration');

export interface IJupyterUriProviderRegistration {
    onDidChangeProviders: Event<void>;
    readonly providers: ReadonlyArray<IInternalJupyterUriProvider>;
    getProviders(): Promise<ReadonlyArray<IInternalJupyterUriProvider>>;
    getProvider(id: string): Promise<IInternalJupyterUriProvider | undefined>;
    registerProvider(provider: IJupyterUriProvider, extensionId: string): IDisposable;
    /**
     * Calling `getJupyterServerUri` just to get the display name could have unnecessary side effects.
     * E.g. we could end up connecting to a remote server or prompting for username/password, etc.
     * This will just return the display name if we have one, or if previously cached.
     */
    getDisplayName(serverHandle: JupyterServerProviderHandle): Promise<string>;
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
    getRequestCtor(allowUnauthorized?: boolean, getAuthHeader?: () => Record<string, string>): ClassType<Request>;
    getFetchMethod(): typeof fetch;
    getHeadersCtor(): ClassType<Headers>;
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
