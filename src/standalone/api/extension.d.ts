// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { CancellationToken, Event, NotebookDocument, QuickPickItem, Uri } from 'vscode';
import type { Kernel } from '@jupyterlab/services/lib/kernel';
import type { Session } from '@jupyterlab/services';

/**
 * Data represents the message payload received over the WebSocket.
 */
export type WebSocketData = string | Buffer | ArrayBuffer | Buffer[];

export interface JupyterAPI {
    /**
     * Registers a remote server provider component that's used to pick remote jupyter server URIs
     * @param serverProvider object called back when picking jupyter server URI
     */
    registerRemoteServerProvider(serverProvider: IJupyterUriProvider): void;
    /**
     * Adds a remote Jupyter Server to the list of Remote Jupyter servers.
     * This will result in the Jupyter extension listing kernels from this server as items in the kernel picker.
     */
    addRemoteJupyterServer(providerId: string, handle: JupyterServerUriHandle): Promise<void>;
    /**
     * Gets the service that provides access to kernels.
     * Returns `undefined` if the calling extension is not allowed to access this API. This could
     * happen either when user doesn't allow this or the extension doesn't allow this.
     * There are a specific set of extensions that are currently allowed to access this API.
     */
    getKernelService(): Promise<IExportedKernelService | undefined>;
    /**
     * Opens a notebook with a specific kernel as the active kernel.
     * @param {Uri} uri Uri of the notebook to open.
     * @param {String} kernelId Id of the kernel, retrieved from getKernelService().getKernelSpecifications()
     * @returns {Promise<NotebookDocument>} Promise that resolves to the notebook document.
     */
    openNotebook(uri: Uri, kernelId: string): Promise<NotebookDocument>;
}

export interface IJupyterServerUri {
    baseUrl: string;
    token: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authorizationHeader: any; // JSON object for authorization header.
    expiration?: Date; // Date/time when header expires and should be refreshed.
    displayName: string;
    workingDirectory?: string;
    /**
     * Returns the sub-protocols to be used. See details of `protocols` here https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
     */
    webSocketProtocols?: string[];
}

export type JupyterServerUriHandle = string;

export interface IJupyterUriProvider {
    /**
     * Should be a unique string (like a guid)
     */
    readonly id: string;
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
    handleQuickPick?(item: QuickPickItem, backEnabled: boolean): Promise<JupyterServerUriHandle | 'back' | undefined>;
    /**
     * Given the handle, returns the Jupyter Server information.
     */
    getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
    /**
     * Gets a list of all valid Jupyter Server handles that can be passed into the `getServerUri` method.
     */
    getHandles?(): Promise<JupyterServerUriHandle[]>;
    /**
     * Users request to remove a handle.
     */
    removeHandle?(handle: JupyterServerUriHandle): Promise<void>;
}

/**
 * The supported Python environment types.
 */
export enum EnvironmentType {
    Unknown = 'Unknown',
    Conda = 'Conda',
    VirtualEnv = 'VirtualEnv',
    Pipenv = 'PipEnv',
    Pyenv = 'Pyenv',
    Venv = 'Venv',
    Poetry = 'Poetry',
    VirtualEnvWrapper = 'VirtualEnvWrapper'
}

/**
 * A representation of a Python runtime's version.
 */
export type PythonVersion = {
    /**
     * The original version string.
     */
    raw: string;
    major: number;
    minor: number;
    patch: number;
};
export type PythonEnvironment = {
    id: string;
    displayName?: string;
    uri: Uri;
    version?: PythonVersion;
    sysPrefix: string;
    envType?: EnvironmentType;
    envName?: string;
    envPath?: Uri;
};

/**
 * Details of the kernel spec.
 * See https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
 */
export interface IJupyterKernelSpec {
    /**
     * Id of an existing (active) Kernel from an active session.
     */
    id?: string;
    name: string;
    /**
     * The name of the language of the kernel
     */
    language?: string;
    path: string;
    /**
     * A dictionary of environment variables to set for the kernel.
     * These will be added to the current environment variables before the kernel is started.
     */
    env?: NodeJS.ProcessEnv | undefined;
    /**
     * Kernel display name.
     */
    readonly display_name: string;
    /**
     * A dictionary of additional attributes about this kernel; used by clients to aid in kernel selection.
     * Optionally storing the interpreter information in the metadata (helping extension search for kernels that match an interpreter).
     * Metadata added here should be namespaced for the tool reading and writing that metadata.
     */
    readonly metadata?: Record<string, unknown> & { interpreter?: Partial<PythonEnvironment> };
    /**
     * A list of command line arguments used to start the kernel.
     * The text {connection_file} in any argument will be replaced with the path to the connection file.
     */
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
     * Plenty of conda packages ship kernels in this manner (beakerx, java, etc).
     */
    interpreterPath?: string;
    /**
     * May be either signal or message and specifies how a client is supposed to interrupt cell execution on this kernel,
     * either by sending an interrupt signal via the operating system’s signalling facilities (e.g. SIGINT on POSIX systems),
     * or by sending an interrupt_request message on the control channel.
     * If this is not specified the client will default to signal mode.
     */
    readonly interrupt_mode?: 'message' | 'signal';
}
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
    interpreter?: undefined;
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
interface IJupyterKernel {
    /**
     * Id of an existing (active) Kernel from an active session.
     */
    id?: string;
    name: string;
}

export type LiveKernelModel = IJupyterKernel &
    Partial<IJupyterKernelSpec> & { model: Session.IModel | undefined; notebook?: { path?: string } };

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

export type KernelConnectionMetadata =
    | LocalKernelSpecConnectionMetadata
    | RemoteKernelSpecConnectionMetadata
    | PythonKernelConnectionMetadata
    | LiveRemoteKernelConnectionMetadata;
export type ActiveKernel = LiveRemoteKernelConnectionMetadata;

export interface IKernelSocket {
    /**
     * Whether the kernel socket is read & available for use.
     * Use `onDidChange` to be notified when this changes.
     */
    ready: boolean;
    /**
     * Event fired when the underlying socket state changes.
     * E.g. when the socket is connected/available or changes to another socket.
     */
    onDidChange: Event<void>;
    /**
     * Sends data to the underlying Jupyter kernel over the socket connection.
     * This bypasses all of the jupyter kernel comms infrastructure.
     */
    sendToRealKernel(data: any, cb?: (err?: Error) => void): void;
    /**
     * Adds a listener to a socket that will be called before the socket's onMessage is called. This
     * allows waiting for a callback before processing messages
     */
    addReceiveHook(hook: (data: WebSocketData) => Promise<void>): void;
    /**
     * Removes a listener for the socket. When no listeners are present, the socket no longer blocks
     */
    removeReceiveHook(hook: (data: WebSocketData) => Promise<void>): void;
    /**
     * Adds a hook to the sending of data from a websocket. Hooks can block sending so be careful.
     */
    addSendHook(hook: (data: any, cb?: (err?: Error) => void) => Promise<void>): void;
    /**
     * Removes a send hook from the socket.
     */
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
    kernelSocket: IKernelSocket;
};

export interface IExportedKernelService {
    readonly status: 'discovering' | 'idle';
    /**
     * Changes in kernel state (e.g. discovered kernels, not discovering kernel, etc).
     */
    onDidChangeStatus: Event<void>;
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
     * Gets a list of all active kernel connections.
     * If `uri` is undefined, then the kernel is not associated with any resource. I.e its currently not associated with any notebook in Jupyter extension.
     * If `uri` is undefined, then the kernel is associated with the resource identified by the Uri.
     */
    getActiveKernels(): { metadata: KernelConnectionMetadata; uri: Uri | undefined }[];
    /**
     * Gets the Kernel connection & the metadata that's associated with a given resource.
     * (only successfully started/active connections are returned).
     */
    getKernel(uri: Uri): { metadata: KernelConnectionMetadata; connection: IKernelConnectionInfo } | undefined;
    /**
     * Starts a kernel for a given resource.
     * The promise is resolved only after the kernel has successfully started.
     * If one attempts to start another kernel for the same resource, the same promise is returned.
     */
    startKernel(
        metadata: KernelConnectionMetadata,
        uri: Uri,
        token?: CancellationToken
    ): Promise<IKernelConnectionInfo>;
    /**
     * Connects an existing kernel to a resource.
     * The promise is resolved only after the kernel is successfully attached to a resource.
     * If one attempts to start another kernel or connect another kernel for the same resource, the same promise is returned.
     */
    connect(metadata: LiveRemoteKernelConnectionMetadata, uri: Uri): Promise<IKernelConnectionInfo>;
}
