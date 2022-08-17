// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import type { Contents, Kernel, KernelMessage, Session } from '@jupyterlab/services';
import type { Observable } from 'rxjs/Observable';
import type { JSONObject } from '@lumino/coreutils';
import type {
    CancellationToken,
    Disposable,
    Event,
    NotebookCell,
    NotebookController,
    NotebookDocument,
    Uri
} from 'vscode';
import type * as nbformat from '@jupyterlab/nbformat';
import { PythonEnvironment } from '../platform/pythonEnvironments/info';
import { IAsyncDisposable, IDisplayOptions, Resource } from '../platform/common/types';
import { IBackupFile, IJupyterKernel } from './jupyter/types';
import { PythonEnvironment_PythonApi } from '../platform/api/types';

export type WebSocketData = string | Buffer | ArrayBuffer | Buffer[];

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
    serverId: string;
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
    serverId: string;
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
export type KernelConnectionMetadata = RemoteKernelConnectionMetadata | LocalKernelConnectionMetadata;

/**
 * Connection metadata for local kernels. Makes it easier to not have to check for the live connection type.
 */
export type LocalKernelConnectionMetadata =
    | Readonly<LocalKernelSpecConnectionMetadata>
    | Readonly<PythonKernelConnectionMetadata>;

/**
 * Connection metadata for remote kernels. Makes it easier to not have to check for the live connection type.
 */
export type RemoteKernelConnectionMetadata =
    | Readonly<LiveRemoteKernelConnectionMetadata>
    | Readonly<RemoteKernelSpecConnectionMetadata>;

export function isLocalConnection(
    kernelConnection: KernelConnectionMetadata
): kernelConnection is LocalKernelConnectionMetadata {
    return (
        kernelConnection.kind === 'startUsingLocalKernelSpec' || kernelConnection.kind === 'startUsingPythonInterpreter'
    );
}

export function isRemoteConnection(
    kernelConnection: KernelConnectionMetadata
): kernelConnection is RemoteKernelConnectionMetadata {
    return !isLocalConnection(kernelConnection);
}

export interface IBaseKernel extends IAsyncDisposable {
    readonly uri: Uri;
    /**
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
    readonly status: KernelMessage.Status;
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
    readonly session?: IKernelConnectionSession;
    /**
     * We create IKernels early on to ensure they are mapped with the notebook documents.
     * I.e. created even before they are used.
     * Thus even if we have an IKernel it doesn't mean that we have a real (underlying) kernel active.
     * This flag will tell us whether a real kernel was or is active.
     */
    readonly startedAtLeastOnce?: boolean;
    start(options?: IDisplayOptions): Promise<void>;
    interrupt(): Promise<void>;
    restart(): Promise<void>;
    addEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void;
    removeEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void;
}

/**
 * Kernels created by this extension.
 */
export interface IKernel extends IBaseKernel {
    /**
     * Total execution count on this kernel
     */
    readonly executionCount: number;
    readonly notebook: NotebookDocument;
    readonly onPreExecute: Event<NotebookCell>;
    /**
     * Cells that are still being executed (or pending).
     */
    readonly pendingCells: readonly NotebookCell[];
    /**
     * Controller associated with this kernel
     */
    readonly controller: NotebookController;
    readonly creator: 'jupyterExtension';
    /**
     * @param cell Cell to execute
     * @param codeOverride Override the code to execute
     */
    executeCell(cell: NotebookCell, codeOverride?: string): Promise<NotebookCellRunState>;
    /**
     * Executes arbitrary code against the kernel without incrementing the execution count.
     */
    executeHidden(code: string): Promise<nbformat.IOutput[]>;
}

/**
 * Kernels created by third party extensions.
 */
export interface IThirdPartyKernel extends IBaseKernel {
    readonly creator: '3rdPartyExtension';
}

/**
 * Kernel options for creating first party kernels.
 */
export type KernelOptions = {
    metadata: KernelConnectionMetadata;
    controller: NotebookController;
    /**
     * When creating a kernel for an Interactive window, pass the Uri of the Python file here (to set the working directory, file & the like)
     * In the case of Notebooks, just pass the uri of the notebook.
     */
    resourceUri: Resource;
};

/**
 * Kernel options for creating third party kernels.
 */
export type ThirdPartyKernelOptions = {
    metadata: KernelConnectionMetadata;
    /**
     * When creating a kernel for an Interactive window, pass the Uri of the Python file here (to set the working directory, file & the like)
     * In the case of Notebooks, just pass the uri of the notebook.
     */
    resourceUri: Resource;
};

/**
 * Common kernel provider interface shared between first party and third party kernel providers.
 */
export interface IBaseKernelProvider<T extends IBaseKernel> extends IAsyncDisposable {
    readonly kernels: Readonly<T[]>;
    onDidCreateKernel: Event<T>;
    onDidStartKernel: Event<T>;
    onDidRestartKernel: Event<T>;
    onDidDisposeKernel: Event<T>;
    onKernelStatusChanged: Event<{ status: KernelMessage.Status; kernel: T }>;
}

/**
 * Kernel provider for fetching and creating kernels inside the extension.
 */
export const IKernelProvider = Symbol('IKernelProvider');
export interface IKernelProvider extends IBaseKernelProvider<IKernel> {
    /**
     * Get hold of the active kernel for a given notebook document.
     */
    get(uriOrNotebook: Uri | NotebookDocument): IKernel | undefined;
    /**
     * Gets or creates a kernel for a given Notebook.
     * WARNING: If called with different options for same Notebook, old kernel associated with the Uri will be disposed.
     */
    getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel;
}

/**
 * Kernel provider used by third party extensions (indirectly).
 */
export const IThirdPartyKernelProvider = Symbol('IThirdPartyKernelProvider');
export interface IThirdPartyKernelProvider extends IBaseKernelProvider<IThirdPartyKernel> {
    /**
     * Get hold of the active kernel for a given resource uri.
     */
    get(uri: Uri): IThirdPartyKernel | undefined;
    /**
     * Gets or creates a kernel for a given resource uri.
     * WARNING: If called with different options for same resource uri, old kernel associated with the Uri will be disposed.
     */
    getOrCreate(uri: Uri, options: ThirdPartyKernelOptions): IThirdPartyKernel;
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
    readonly url: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAuthHeader?(): any; // Snould be a json object
}

export type INotebookProviderConnection = IRawConnection | IJupyterConnection;

export enum InterruptResult {
    Success = 'success',
    TimedOut = 'timeout',
    Restarted = 'restart'
}

/**
 * Closely represents Jupyter Labs Kernel.IKernelConnection.
 */
export interface IBaseKernelConnectionSession extends IAsyncDisposable {
    readonly disposed: boolean;
    readonly kernel?: Kernel.IKernelConnection;
    readonly status: KernelMessage.Status;
    readonly kernelId: string;
    readonly kernelSocket: Observable<KernelSocketInformation | undefined>;
    isServerSession(): this is IJupyterKernelConnectionSession;
    onSessionStatusChanged: Event<KernelMessage.Status>;
    onDidDispose: Event<void>;
    interrupt(): Promise<void>;
    restart(): Promise<void>;
    waitForIdle(timeout: number, token: CancellationToken): Promise<void>;
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

export interface IJupyterKernelConnectionSession extends IBaseKernelConnectionSession {
    readonly kind: 'remoteJupyter' | 'localJupyter';
    invokeWithFileSynced(contents: string, handler: (file: IBackupFile) => Promise<void>): Promise<void>;
    createTempfile(ext: string): Promise<string>;
    deleteTempfile(file: string): Promise<void>;
    getContents(file: string, format: Contents.FileFormat): Promise<Contents.IModel>;
}
export interface IRawKernelConnectionSession extends IBaseKernelConnectionSession {
    readonly kind: 'localRaw';
}
export type IKernelConnectionSession = IJupyterKernelConnectionSession | IRawKernelConnectionSession;

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

export type GetServerOptions =
    | {
          ui: IDisplayOptions;
          localJupyter: true;
          token: CancellationToken | undefined;
          resource: Resource;
          serverId?: undefined;
      }
    | {
          ui: IDisplayOptions;
          localJupyter: false;
          token: CancellationToken | undefined;
          resource: Resource;
          serverId: string;
      };

// Options for connecting to a notebook provider
export type ConnectNotebookProviderOptions = GetServerOptions;
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
    create(options: NotebookCreationOptions): Promise<IKernelConnectionSession>;
    /**
     * Connect to a notebook provider to prepare its connection and to get connection information
     */
    connect(options: ConnectNotebookProviderOptions): Promise<INotebookProviderConnection>;
}

export interface IKernelSocket {
    /**
     * These messages are sent directly to the kernel bypassing the Jupyter lab npm libraries.
     * As a result, we don't get any notification that messages were sent (on the anymessage signal).
     * To ensure those signals can still be used to monitor such messages, send them via a callback so that we can emit these messages on the anymessage signal.
     */
    onAnyMessage: Event<{ msg: string | KernelMessage.IMessage; direction: 'send' }>;
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
    listKernels(
        resource: Resource,
        cancelToken?: CancellationToken,
        useCache?: 'useCache' | 'ignoreCache'
    ): Promise<KernelConnectionMetadata[]>;
}

export type KernelAction = 'start' | 'interrupt' | 'restart' | 'execution';

export type KernelActionSource = 'jupyterExtension' | '3rdPartyExtension';

export const ITracebackFormatter = Symbol('ITracebackFormatter');
export interface ITracebackFormatter {
    /**
     * Modifies a traceback from an error message.
     * Tracebacks take a form like so:
     * "[1;31m---------------------------------------------------------------------------[0m"
     * "[1;31mZeroDivisionError[0m                         Traceback (most recent call last)"
     * "[1;32md:\Training\SnakePython\foo.py[0m in [0;36m<module>[1;34m[0m\n[0;32m      1[0m [0mprint[0m[1;33m([0m[1;34m'some more'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [1;32m----> 2[1;33m [0mcause_error[0m[1;33m([0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0m"
     * "[1;32md:\Training\SnakePython\foo.py[0m in [0;36mcause_error[1;34m()[0m\n[0;32m      3[0m     [0mprint[0m[1;33m([0m[1;34m'error'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0;32m      4[0m     [0mprint[0m[1;33m([0m[1;34m'now'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [1;32m----> 5[1;33m     [0mprint[0m[1;33m([0m [1;36m1[0m [1;33m/[0m [1;36m0[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0m"
     * "[1;31mZeroDivisionError[0m: division by zero"
     * Each item in the array being a stack frame.
     */
    format(cell: NotebookCell, traceback: string[]): string[];
}

export const enum StartupCodePriority {
    Base = 0,
    Debugging = 5
}

/**
 * Startup code provider provides code snippets that are run right after the kernel is started but before running any code.
 */
export const IStartupCodeProvider = Symbol('IStartupCodeProvider');
export interface IStartupCodeProvider {
    priority: StartupCodePriority;
    getCode(kernel: IBaseKernel): Promise<string[]>;
}
