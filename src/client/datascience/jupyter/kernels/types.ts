// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { KernelMessage, Session } from '@jupyterlab/services';
import type { Observable } from 'rxjs/Observable';
import type { Event, NotebookCell, NotebookController, NotebookDocument, QuickPickItem } from 'vscode';
import type { IAsyncDisposable, Resource } from '../../../common/types';
import type { PythonEnvironment } from '../../../pythonEnvironments/info';
import type {
    IJupyterKernel,
    IJupyterKernelSpec,
    IJupyterSession,
    INotebookProviderConnection,
    KernelSocketInformation
} from '../../types';
import type * as nbformat from '@jupyterlab/nbformat';
import * as url from 'url';

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
    | Readonly<LiveKernelConnectionMetadata>
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

export function isLocalHostConnection(kernelConnection: KernelConnectionMetadata): boolean {
    if (kernelConnection.kind === 'connectToLiveKernel' || kernelConnection.kind === 'startUsingRemoteKernelSpec') {
        const parsed = new url.URL(kernelConnection.baseUrl);
        return parsed.hostname.toLocaleLowerCase() === 'localhost' || parsed.hostname === '127.0.0.1';
    }
    return false;
}

export interface IKernel extends IAsyncDisposable {
    readonly connection: INotebookProviderConnection | undefined;
    /**
     * Notebook that owns this kernel.
     * Closing the notebook will dispose this kernel (except in the case of remote kernels).
     */
    readonly notebookDocument: NotebookDocument;
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
    readonly onWillRestart: Event<void>;
    readonly onWillInterrupt: Event<void>;
    readonly onPreExecute: Event<NotebookCell>;
    readonly status: KernelMessage.Status;
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
    start(options?: { disableUI?: boolean }): Promise<void>;
    interrupt(): Promise<void>;
    restart(): Promise<void>;
    executeCell(cell: NotebookCell): Promise<NotebookCellRunState>;
    /**
     * Executes arbitrary code against the kernel without incrementing the execution count.
     */
    executeHidden(code: string): Promise<nbformat.IOutput[]>;
}

export type KernelOptions = {
    metadata: KernelConnectionMetadata;
    controller: NotebookController;
    /**
     * When creating a kernel for an Interactive window, pass the Uri of the Python file here (to set the working directory, file & the like)
     * In the case of Notebooks, just pass the uri of the notebook.
     */
    resourceUri: Resource;
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
    get(notebook: NotebookDocument): IKernel | undefined;
    /**
     * Gets or creates a kernel for a given Notebook.
     * WARNING: If called with different options for same Notebook, old kernel associated with the Uri will be disposed.
     */
    getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel;
}
