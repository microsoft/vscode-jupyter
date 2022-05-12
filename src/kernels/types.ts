// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import type { Observable } from 'rxjs/Observable';
import type { JSONObject } from '@lumino/coreutils';
import type {
    CancellationToken,
    Disposable,
    Event,
    NotebookCell,
    NotebookController,
    QuickPickItem,
    Uri
} from 'vscode';
import type * as nbformat from '@jupyterlab/nbformat';
import { PythonEnvironment } from '../platform/pythonEnvironments/info';
import { IAsyncDisposable, IDisplayOptions, Resource } from '../platform/common/types';
import { WebSocketData } from '../platform/api/extension';
import { IJupyterKernel } from './jupyter/types';
import { PythonEnvironment_PythonApi } from '../platform/api/types';

export type LiveKernelModel = IJupyterKernel &
    Partial<IJupyterKernelSpec> & { model: Session.IModel | undefined; notebook?: { path?: string } };

export enum NotebookCellRunState {
    Idle = 'Idle',
    Success = 'Success',
    Error = 'Error'
}
/**
 * Connection metadata for Live Kernels.
 * With this we are able connect to an existing kernel (instead of starting a new session).
 */
export type LiveRemoteKernelConnectionMetadata = Readonly<{
    kernelModel: LiveKernelModel;
    /**
     * Python interpreter will be used for intellisense & the like.
     */
    interpreter?: PythonEnvironment;
    baseUrl: string;
    kind: 'connectToLiveRemoteKernel';
    id: string;
}>;
/**
 * Connection metadata for Kernels started using kernelspec (JSON).
 * This could be a raw kernel (spec might have path to executable for .NET or the like).
 * If the executable is not defined in kernelspec json, & it is a Python kernel, then we'll use the provided python interpreter.
 */
export type LocalKernelSpecConnectionMetadata = Readonly<{
    kernelModel?: undefined;
    kernelSpec: IJupyterKernelSpec;
    /**
     * Indicates the interpreter that may be used to start the kernel.
     * If possible to start a kernel without this Python interpreter, then this Python interpreter will be used for intellisense & the like.
     * This interpreter could also be the interpreter associated with the kernel spec that we are supposed to start.
     */
    interpreter?: PythonEnvironment;
    kind: 'startUsingLocalKernelSpec';
    id: string;
}>;
/**
 * Connection metadata for Remote Kernels started using kernelspec (JSON).
 * This could be a raw kernel (spec might have path to executable for .NET or the like).
 * If the executable is not defined in kernelspec json, & it is a Python kernel, then we'll use the provided python interpreter.
 */
export type RemoteKernelSpecConnectionMetadata = Readonly<{
    kernelModel?: undefined;
    interpreter?: PythonEnvironment; // Can be set if URL is localhost
    kernelSpec: IJupyterKernelSpec;
    kind: 'startUsingRemoteKernelSpec';
    baseUrl: string;
    id: string;
}>;
/**
 * Connection metadata for Kernels started using Python interpreter.
 * These are not necessarily raw (it could be plain old Jupyter Kernels, where we register Python interpreter as a kernel).
 * We can have KernelSpec information here as well, however that is totally optional.
 * We will always start this kernel using old Jupyter style (provided we first register this interpreter as a kernel) or raw.
 */
export type PythonKernelConnectionMetadata = Readonly<{
    kernelSpec: IJupyterKernelSpec;
    interpreter: PythonEnvironment;
    kind: 'startUsingPythonInterpreter';
    id: string;
}>;
/**
 * Readonly to ensure these are immutable, if we need to make changes then create a new one.
 * This ensure we don't update is somewhere unnecessarily (such updates would be unexpected).
 * Unexpected as connections are defined once & not changed, if we need to change then user needs to create a new connection.
 */
export type KernelConnectionMetadata =
    | Readonly<LiveRemoteKernelConnectionMetadata>
    | Readonly<LocalKernelSpecConnectionMetadata>
    | Readonly<RemoteKernelSpecConnectionMetadata>
    | Readonly<PythonKernelConnectionMetadata>;

/**
 * Connection metadata for local kernels. Makes it easier to not have to check for the live connection type.
 */
export type LocalKernelConnectionMetadata =
    | Readonly<LocalKernelSpecConnectionMetadata>
    | Readonly<PythonKernelConnectionMetadata>;

export interface IKernelSpecQuickPickItem<T extends KernelConnectionMetadata = KernelConnectionMetadata>
    extends QuickPickItem {
    selection: T;
}

export function isLocalConnection(
    kernelConnection: KernelConnectionMetadata
): kernelConnection is LocalKernelConnectionMetadata {
    return (
        kernelConnection.kind === 'startUsingLocalKernelSpec' || kernelConnection.kind === 'startUsingPythonInterpreter'
    );
}

export interface IKernel extends IAsyncDisposable {
    readonly connection: INotebookProviderConnection | undefined;
    readonly id: Uri;
    /**;
     * In the case of Notebooks, this is the same as the Notebook Uri.
     * But in the case of Interactive Window, this is the Uri of the file (such as the Python file).
     * However if we create an intearctive window without a file, then this is undefined.
     */
    readonly resourceUri: Resource;
    /**
     * Connection metadata used to start/connect to a kernel.
     * When dealing with local & remote kernels we can start a kernel.
     * When dealing with existing (live/already running) kernels, we then connect to an existing kernel.
     */
    readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>;
    readonly onStatusChanged: Event<KernelMessage.Status>;
    readonly onDisposed: Event<void>;
    readonly onStarted: Event<void>;
    readonly onRestarted: Event<void>;
    readonly onPreExecute: Event<NotebookCell>;
    readonly status: KernelMessage.Status;
    /**
     * Who created this kernel, 3rd party extension or our (jupyter) extension.
     */
    readonly creator: KernelActionSource;
    /**
     * Cells that are still being executed (or pending).
     */
    readonly pendingCells: readonly NotebookCell[];
    readonly disposed: boolean;
    readonly disposing: boolean;
    /**
     * Kernel information, used to save in ipynb in the metadata.
     * Crucial for non-python notebooks, else we save the incorrect information.
     */
    readonly info?: KernelMessage.IInfoReplyMsg['content'];
    /**
     * Provides access to the underlying Kernel (web) socket.
     * The socket changes upon restarting the kernel, hence the use of an observable.
     */
    readonly kernelSocket: Observable<KernelSocketInformation | undefined>;
    /**
     * Provides access to the underlying kernel.
     * The Jupyter kernel can be directly access via the `session.kernel` property.
     */
    readonly session?: IJupyterSession;
    /**
     * We create IKernels early on to ensure they are mapped with the notebook documents.
     * I.e. created even before they are used.
     * Thus even if we have an IKernel it doesn't mean that we have a real (underlying) kernel active.
     * This flag will tell us whether a real kernel was or is active.
     */
    readonly startedAtLeastOnce?: boolean;
    /**
     * Controller associated with this kernel
     */
    readonly controller: NotebookController;
    start(options?: IDisplayOptions): Promise<void>;
    interrupt(): Promise<void>;
    restart(): Promise<void>;
    executeCell(cell: NotebookCell): Promise<NotebookCellRunState>;
    /**
     * Executes arbitrary code against the kernel without incrementing the execution count.
     */
    executeHidden(code: string): Promise<nbformat.IOutput[]>;
    addEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void;
    removeEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void;
}

export type KernelOptions = {
    metadata: KernelConnectionMetadata;
    controller: NotebookController;
    /**
     * When creating a kernel for an Interactive window, pass the Uri of the Python file here (to set the working directory, file & the like)
     * In the case of Notebooks, just pass the uri of the notebook.
     */
    resourceUri: Resource;
    /**
     * What is initiating this kernel action, is it Jupyter or a 3rd party extension.
     */
    creator: KernelActionSource;
};
export const IKernelProvider = Symbol('IKernelProvider');
export interface IKernelProvider extends IAsyncDisposable {
    readonly kernels: Readonly<IKernel[]>;
    onDidStartKernel: Event<IKernel>;
    onDidRestartKernel: Event<IKernel>;
    onDidDisposeKernel: Event<IKernel>;
    onKernelStatusChanged: Event<{ status: KernelMessage.Status; kernel: IKernel }>;
    /**
     * Get hold of the active kernel for a given Notebook.
     */
    get(uri: Uri): IKernel | undefined;
    /**
     * Gets or creates a kernel for a given Notebook.
     * WARNING: If called with different options for same Notebook, old kernel associated with the Uri will be disposed.
     */
    getOrCreate(uri: Uri, options: KernelOptions): IKernel;
}

export interface IRawConnection {
    readonly type: 'raw';
    readonly localLaunch: true;
    readonly displayName: string;
}

export interface IJupyterConnection extends Disposable {
    readonly type: 'jupyter';
    readonly localLaunch: boolean;
    readonly displayName: string;
    disconnected: Event<number>;

    // Jupyter specific members
    readonly baseUrl: string;
    readonly token: string;
    readonly hostName: string;
    readonly rootDirectory: Uri; // Directory where the notebook server was started.
    readonly url?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAuthHeader?(): any; // Snould be a json object
}

export type INotebookProviderConnection = IRawConnection | IJupyterConnection;

export enum InterruptResult {
    Success = 'success',
    TimedOut = 'timeout',
    Restarted = 'restart'
}

export interface INotebook {
    readonly connection: INotebookProviderConnection | undefined;
    readonly session: IJupyterSession; // Temporary. This just makes it easier to write a notebook that works with VS code types.
}

// Options for connecting to a notebook provider
export type ConnectNotebookProviderOptions = {
    ui: IDisplayOptions;
    kind: 'localJupyter' | 'remoteJupyter';
    token: CancellationToken | undefined;
    resource: Resource;
};

export const IJupyterSession = Symbol('IJupyterSession');
/**
 * Closely represents Jupyter Labs Kernel.IKernelConnection.
 */
export interface IJupyterSession extends IAsyncDisposable {
    readonly kind: 'localRaw' | 'remoteJupyter' | 'localJupyter';
    readonly disposed: boolean;
    readonly kernel?: Kernel.IKernelConnection;
    readonly status: KernelMessage.Status;
    readonly kernelId: string;
    readonly kernelSocket: Observable<KernelSocketInformation | undefined>;
    onSessionStatusChanged: Event<KernelMessage.Status>;
    onDidDispose: Event<void>;
    onIOPubMessage: Event<KernelMessage.IIOPubMessage>;
    interrupt(): Promise<void>;
    restart(): Promise<void>;
    waitForIdle(timeout: number): Promise<void>;
    requestExecute(
        content: KernelMessage.IExecuteRequestMsg['content'],
        disposeOnDone?: boolean,
        metadata?: JSONObject
    ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>;
    requestDebug(
        content: KernelMessage.IDebugRequestMsg['content'],
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg>;
    requestComplete(content: KernelMessage.ICompleteRequestMsg['content']): Promise<KernelMessage.ICompleteReplyMsg>;
    requestInspect(content: KernelMessage.IInspectRequestMsg['content']): Promise<KernelMessage.IInspectReplyMsg>;
    sendInputReply(content: KernelMessage.IInputReply): void;
    registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ): void;
    registerMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void;
    removeMessageHook(msgId: string, hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>): void;
    requestKernelInfo(): Promise<KernelMessage.IInfoReplyMsg | undefined>;
    shutdown(): Promise<void>;
}

export type ISessionWithSocket = Session.ISessionConnection & {
    /**
     * The resource associated with this session.
     */
    resource: Resource;
    /**
     * Whether this is a remote session that we attached to.
     */
    isRemoteSession?: boolean;
    /**
     * Socket information used for hooking messages to the kernel.
     */
    kernelSocketInformation: KernelSocketInformation;
    kernelConnectionMetadata: KernelConnectionMetadata;
};

export interface IJupyterKernelSpec {
    /**
     * Id of an existing (active) Kernel from an active session.
     *
     * @type {string}
     * @memberof IJupyterKernel
     */
    id?: string;
    name: string;
    language?: string;
    executable: string; // argv[0] of the kernelspec.json
    env?: NodeJS.ProcessEnv | undefined;
    /**
     * Kernel display name.
     *
     * @type {string}
     * @memberof IJupyterKernelSpec
     */
    readonly display_name: string;
    /**
     * A dictionary of additional attributes about this kernel; used by clients to aid in kernel selection.
     * Optionally storing the interpreter information in the metadata (helping extension search for kernels that match an interpereter).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly metadata?: Record<string, any> & {
        vscode?: {
            /**
             * Optionally where the original user-created kernel spec json is located on the local FS.
             * Remember when using non-raw we create kernelspecs from the original spec.
             */
            originalSpecFile?: string;
            /**
             * E.g. assume we're loading a kernlespec for a default Python kernel, the name would be `python3`
             * However we give this a completely different name, and at that point its not possible to determine
             * whether this is a default kernel or not.
             * Hence keep track of the original name in the metadata.
             */
            originalDisplayName?: string;
        };
        interpreter?: Partial<PythonEnvironment_PythonApi>; // read from disk so has to follow old format
        /**
         * @deprecated (use metadata.jupyter.originalSpecFile)
         */
        originalSpecFile?: string;
    };
    readonly argv: string[];
    /**
     * Optionally where this kernel spec json is located on the local FS.
     */
    specFile?: string;
    /**
     * Optionally the Interpreter this kernel spec belongs to.
     * You can have kernel specs that are scoped to an interpreter.
     * E.g. if you have Python in `c:\Python\Python3.8`
     * Then you could have kernels in `<sys.prefix folder for this interpreter>\share\jupyter\kernels`
     * Plenty of conda packages ship kernels in this manner (beakerx, etc).
     */
    interpreterPath?: string; // Has to be a string as old kernelspecs wrote it this way
    readonly interrupt_mode?: 'message' | 'signal';
    /**
     * Whether the kernelspec is registered by VS Code
     */
    readonly isRegisteredByVSC?:
        | 'registeredByNewVersionOfExt'
        | 'registeredByOldVersionOfExt'
        | 'registeredByNewVersionOfExtForCustomKernelSpec';
}

export type GetServerOptions = {
    ui: IDisplayOptions;
    /**
     * Whether we're only interested in local Jupyter Servers.
     */
    localJupyter: boolean;
    token: CancellationToken | undefined;
    resource: Resource;
};

/**
 * Options for getting a notebook
 */
export type NotebookCreationOptions = {
    resource: Resource;
    ui: IDisplayOptions;
    kernelConnection: KernelConnectionMetadata;
    token: CancellationToken;
    creator: KernelActionSource;
};

export const INotebookProvider = Symbol('INotebookProvider');
export interface INotebookProvider {
    /**
     * Creates a notebook.
     */
    createNotebook(options: NotebookCreationOptions): Promise<INotebook>;
    /**
     * Connect to a notebook provider to prepare its connection and to get connection information
     */
    connect(options: ConnectNotebookProviderOptions): Promise<INotebookProviderConnection>;
}

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

export type KernelSocketOptions = {
    /**
     * Kernel Id.
     */
    readonly id: string;
    /**
     * Kernel ClientId.
     */
    readonly clientId: string;
    /**
     * Kernel UserName.
     */
    readonly userName: string;
    /**
     * Kernel model.
     */
    readonly model: {
        /**
         * Unique identifier of the kernel server session.
         */
        readonly id: string;
        /**
         * The name of the kernel.
         */
        readonly name: string;
    };
};
export type KernelSocketInformation = {
    /**
     * Underlying socket used by jupyterlab/services to communicate with kernel.
     * See jupyterlab/services/kernel/default.ts
     */
    readonly socket?: IKernelSocket;
    /**
     * Options used to clone a kernel.
     */
    readonly options: KernelSocketOptions;
};

/**
 * Response for installation of kernel dependencies such as ipykernel.
 * (these values are used in telemetry)
 */
export enum KernelInterpreterDependencyResponse {
    ok = 0, // Used in telemetry.
    cancel = 1, // Used in telemetry.
    failed = 2, // Used in telemetry.
    selectDifferentKernel = 3, // Used in telemetry.
    uiHidden = 4 // Used in telemetry.
}

export const IKernelDependencyService = Symbol('IKernelDependencyService');
export interface IKernelDependencyService {
    /**
     * @param {boolean} [ignoreCache] We cache the results of this call so we don't have to do it again (users rarely uninstall ipykernel).
     */
    installMissingDependencies(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        ui: IDisplayOptions,
        token: CancellationToken,
        ignoreCache?: boolean,
        cannotChangeKernels?: boolean
    ): Promise<KernelInterpreterDependencyResponse>;
    /**
     * @param {boolean} [ignoreCache] We cache the results of this call so we don't have to do it again (users rarely uninstall ipykernel).
     */
    areDependenciesInstalled(
        kernelConnection: KernelConnectionMetadata,
        token?: CancellationToken,
        ignoreCache?: boolean
    ): Promise<boolean>;
}

export const IKernelFinder = Symbol('IKernelFinder');

export interface IKernelFinder {
    rankKernels(
        resource: Resource,
        option?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken,
        useCache?: 'useCache' | 'ignoreCache'
    ): Promise<KernelConnectionMetadata[] | undefined>;
    listKernels(
        resource: Resource,
        cancelToken?: CancellationToken,
        useCache?: 'useCache' | 'ignoreCache'
    ): Promise<KernelConnectionMetadata[]>;
    // For the given kernel connection, return true if it's an exact match for the notebookMetadata
    isExactMatch(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        notebookMetadata: nbformat.INotebookMetadata | undefined
    ): boolean;
}

export type KernelAction = 'start' | 'interrupt' | 'restart' | 'execution';

export type KernelActionSource = 'jupyterExtension' | '3rdPartyExtension';
