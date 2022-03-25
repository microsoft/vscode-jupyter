/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CancellationToken, Event, NotebookDocument } from 'vscode';
import type { Kernel } from '@jupyterlab/services/lib/kernel';
import type { Session } from '@jupyterlab/services';

/**
 * Data represents the message payload received over the WebSocket.
 */
export type WebSocketData = string | Buffer | ArrayBuffer | Buffer[];

export interface JupyterAPI {
    /**
     * Gets the service that provides access to kernels.
     * Returns `undefined` if the calling extension is not allowed to access this API. This could
     * happen either when user doesn't allow this or the extension doesn't allow this.
     * There are a specific set of extensions that are currently allowed to access this API.
     */
    getKernelService(): Promise<IExportedKernelService | undefined>;
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
    WindowsStore = 'WindowsStore',
    Poetry = 'Poetry',
    VirtualEnvWrapper = 'VirtualEnvWrapper',
    Global = 'Global',
    System = 'System'
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
    build: string[];
    /**
     * Identifies a tag in the release process (e.g. beta 1)
     */
    prerelease: string[];
};
export type PythonEnvironment = {
    displayName?: string;
    path: string;
    version?: PythonVersion;
    sysPrefix: string;
    envType?: EnvironmentType;
    envName?: string;
    envPath?: string;
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
export type LiveKernelConnectionMetadata = Readonly<{
    kernelModel: LiveKernelModel;
    /**
     * Python interpreter will be used for intellisense & the like.
     */
    interpreter?: PythonEnvironment;
    baseUrl: string;
    kind: 'connectToLiveKernel';
    id: string;
}>;

export type KernelConnectionMetadata =
    | LocalKernelSpecConnectionMetadata
    | RemoteKernelSpecConnectionMetadata
    | PythonKernelConnectionMetadata
    | LiveRemoteKernelConnectionMetadata;

export type LiveRemoteKernelConnectionMetadata = LiveKernelConnectionMetadata;
export type ActiveKernel = LiveKernelConnectionMetadata;

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
     * @param {boolean} [refresh] Whether to force a refresh of the kernel specs (useful when dealing with remote kernels, as that list can change).
     */
    getKernelSpecifications(refresh?: boolean): Promise<KernelConnectionMetadata[]>;
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
