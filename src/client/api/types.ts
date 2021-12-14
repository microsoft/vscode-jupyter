// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CancellationToken, Disposable, Event, NotebookDocument, Uri } from 'vscode';
import * as lsp from 'vscode-languageserver-protocol';
import { InterpreterUri } from '../common/installer/types';
import { InstallerResponse, Product, Resource } from '../common/types';
import { IInterpreterQuickPickItem } from '../interpreter/configuration/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import type { SemVer } from 'semver';
import type { Data as WebSocketData } from 'ws';
import {
    LiveKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../datascience/jupyter/kernels/types';
import type { Kernel } from '@jupyterlab/services';
import { Observable } from 'rxjs';
export type ILanguageServerConnection = Pick<
    lsp.ProtocolConnection,
    'sendRequest' | 'sendNotification' | 'onProgress' | 'sendProgress' | 'onNotification' | 'onRequest'
>;

export interface ILanguageServer extends Disposable {
    readonly connection: ILanguageServerConnection;
    readonly capabilities: lsp.ServerCapabilities;
}

export const IPythonApiProvider = Symbol('IPythonApi');
export interface IPythonApiProvider {
    onDidActivatePythonExtension: Event<void>;
    getApi(): Promise<PythonApi>;
    setApi(api: PythonApi): void;
}
export const IPythonExtensionChecker = Symbol('IPythonExtensionChecker');
export interface IPythonExtensionChecker {
    readonly isPythonExtensionInstalled: boolean;
    readonly isPythonExtensionActive: boolean;
    showPythonExtensionInstallRequiredPrompt(): Promise<void>;
}

/**
 * This allows Python exntension to update Product enum without breaking Jupyter.
 * I.e. we have a strict contract, else using numbers (in enums) is bound to break across products.
 */
export enum JupyterProductToInstall {
    jupyter = 'jupyter',
    ipykernel = 'ipykernel',
    notebook = 'notebook',
    kernelspec = 'kernelspec',
    nbconvert = 'nbconvert',
    pandas = 'pandas',
    pip = 'pip'
}

/**
 * Implement this interface to control the visibility of the interpreter statusbar.
 */
export interface IInterpreterStatusbarVisibilityFilter {
    readonly changed?: Event<void>;
    readonly hidden: boolean;
}

export type PythonApi = {
    /**
     * IInterpreterService
     */
    onDidChangeInterpreter: Event<void>;
    onDidChangeInterpreters: Event<void>;
    /**
     * IInterpreterService
     */
    getInterpreters(resource?: Uri): Promise<PythonEnvironment[]>;
    /**
     * IInterpreterService
     */
    getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined>;
    /**
     * IInterpreterService
     */
    getInterpreterDetails(pythonPath: string, resource?: Uri): Promise<undefined | PythonEnvironment>;

    /**
     * IEnvironmentActivationService
     */
    getActivatedEnvironmentVariables(
        resource: Resource,
        interpreter: PythonEnvironment,
        allowExceptions?: boolean
    ): Promise<NodeJS.ProcessEnv | undefined>;
    /**
     * IWindowsStoreInterpreter
     */
    getSuggestions(resource: Resource): Promise<IInterpreterQuickPickItem[]>;
    /**
     * IInstaller
     */
    install(
        product: JupyterProductToInstall,
        resource?: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse>;
    /**
     * Retrieve interpreter path selected for Jupyter server from Python memento storage
     */
    getInterpreterPathSelectedForJupyterServer(): string | undefined;
    /**
     * Returns path to where `debugpy` is. In python extension this is `/pythonFiles/lib/python`.
     */
    getDebuggerPath(): Promise<string>;
    /**
     * Returns a ILanguageServer that can be used for communicating with a language server process.
     * @param resource file that determines which connection to return
     */
    getLanguageServer(resource?: InterpreterUri): Promise<ILanguageServer | undefined>;
    /**
     * Registers a visibility filter for the interpreter status bar.
     */
    registerInterpreterStatusFilter(filter: IInterpreterStatusbarVisibilityFilter): void;
    getCondaVersion?(): Promise<SemVer | undefined>;
    /**
     * Returns the conda executable.
     */
    getCondaFile?(): Promise<string | undefined>;
    getEnvironmentActivationShellCommands?(
        resource: Resource,
        interpreter?: PythonEnvironment
    ): Promise<string[] | undefined>;
};

export const IPythonInstaller = Symbol('IPythonInstaller');
export interface IPythonInstaller {
    readonly onInstalled: Event<{ product: Product; resource?: InterpreterUri }>;
    install(
        product: Product,
        resource?: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean,
        installPipIfRequired?: boolean
    ): Promise<InstallerResponse>;
}

export const IPythonDebuggerPathProvider = Symbol('IPythonDebuggerPathProvider');
export interface IPythonDebuggerPathProvider {
    getDebuggerPath(): Promise<string>;
}

export const ILanguageServerProvider = Symbol('ILanguageServerProvider');
export interface ILanguageServerProvider {
    getLanguageServer(resource?: InterpreterUri): Promise<ILanguageServer | undefined>;
}

export type KernelConnectionMetadata =
    | Readonly<Omit<LocalKernelSpecConnectionMetadata, 'interpreter'> & { interpreter?: { path: string } }>
    | Readonly<Omit<RemoteKernelSpecConnectionMetadata, 'interpreter'> & { interpreter?: { path: string } }>
    | Readonly<Omit<PythonKernelConnectionMetadata, 'interpreter'> & { interpreter: { path: string } }>
    | LiveRemoteKernelConnectionMetadata;

export type LiveRemoteKernelConnectionMetadata = Readonly<
    Omit<LiveKernelConnectionMetadata, 'interpreter'> & { interpreter?: { path: string } }
>;
export type ActiveKernel = Readonly<Omit<LiveKernelConnectionMetadata, 'interpreter'>>;

export interface IKernelSocket {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendToRealKernel(data: any, cb?: (err?: Error) => void): void;
    /**
     * Adds a listener to a socket that will be called before the socket's onMessage is called. This
     * allows waiting for a callback before processing messages
     * @param listener
     */
    addReceiveHook(hook: (data: WebSocketData) => Promise<void>): void;
    /**
     * Removes a listener for the socket. When no listeners are present, the socket no longer blocks
     * @param listener
     */
    removeReceiveHook(hook: (data: WebSocketData) => Promise<void>): void;
    /**
     * Adds a hook to the sending of data from a websocket. Hooks can block sending so be careful.
     * @param patch
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addSendHook(hook: (data: any, cb?: (err?: Error) => void) => Promise<void>): void;
    /**
     * Removes a send hook from the socket.
     * @param hook
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeSendHook(hook: (data: any, cb?: (err?: Error) => void) => Promise<void>): void;
}

export type IKernelConnectionInfo = {
    /**
     * Gives access to the jupyterlab Kernel.IKernelConnection object.
     */
    connection: Kernel.IKernelConnection;
    /**
     * Underlying socket used by jupyterlab/services to communicate with kernel.
     * See jupyterlab/services/kernel/default.ts
     */
    kernelSocket: Observable<IKernelSocket | undefined>;
};
export interface IExportedKernelService {
    /**
     * List of running kernels changed.
     */
    onDidChangeKernels: Event<void>;
    /**
     * List of kernel specs changed.
     */
    onDidChangeKernelSpecifications: Event<void>;
    /**
     * Gets a list of all kernel specifications that can be used to start a new kernel or to connect to an existing kernel.
     * Local, remote kernels are returned, including Python interpreters that
     * are treated as kernelspecs (as we can start Kernels for Python interpreters without Jupyter).
     */
    getKernelSpecifications(): Promise<KernelConnectionMetadata[]>;
    /**
     * Gets a list of all active kernel connections associated with a notebook.
     */
    getActiveKernels(): Promise<{ metadata: KernelConnectionMetadata; notebook: NotebookDocument }[]>;
    /**
     * Gets the Kernel connection & the metadata that's associated with a give notebook.
     * (only successfully started/active connections are returned).
     */
    getKernel(
        notebook: NotebookDocument
    ): { metadata: KernelConnectionMetadata; connection: IKernelConnectionInfo } | undefined;
    /**
     * Starts a kernel for a give notebook.
     * The promise is resolved only after the kernel has successfully started.
     * If one attempts to start another kernel for the same notebook, the same promise is returned.
     */
    startKernel(
        metadata: KernelConnectionMetadata,
        notebook: NotebookDocument,
        token?: CancellationToken
    ): Promise<IKernelConnectionInfo>;
    /**
     * Connects an existing kernel to a notebook.
     * The promise is resolved only after the kernel is successfully attached to a notebook.
     * If one attempts to start another kernel or connect another kernel for the same notebook, the same promise is returned.
     */
    connect(metadata: LiveRemoteKernelConnectionMetadata, notebook: NotebookDocument): Promise<IKernelConnectionInfo>;
}
