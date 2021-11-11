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
    InterruptResult,
    KernelSocketInformation
} from '../../types';
import type * as nbformat from '@jupyterlab/nbformat';

export type LiveKernelModel = IJupyterKernel &
    Partial<IJupyterKernelSpec> & { model: Session.IModel | undefined; notebook?: { path?: string } };

export enum NotebookCellRunState {
    Running = 1,
    Idle = 2,
    Success = 3,
    Error = 4
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
    kind: 'connectToLiveKernel';
    id: string;
}>;
/**
 * Connection metadata for Kernels started using kernelspec (JSON).
 * This could be a raw kernel (spec might have path to executable for .NET or the like).
 * If the executable is not defined in kernelspec json, & it is a Python kernel, then we'll use the provided python interpreter.
 */
export type KernelSpecConnectionMetadata = Readonly<{
    kernelModel?: undefined;
    kernelSpec: IJupyterKernelSpec;
    /**
     * Indicates the interpreter that may be used to start the kernel.
     * If possible to start a kernel without this Python interpreter, then this Python interpreter will be used for intellisense & the like.
     * This interpreter could also be the interpreter associated with the kernel spec that we are supposed to start.
     */
    interpreter?: PythonEnvironment;
    kind: 'startUsingKernelSpec';
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
    | Readonly<KernelSpecConnectionMetadata>
    | Readonly<PythonKernelConnectionMetadata>;

/**
 * Connection metadata for local kernels. Makes it easier to not have to check for the live connection type.
 */
export type LocalKernelConnectionMetadata =
    | Readonly<KernelSpecConnectionMetadata>
    | Readonly<PythonKernelConnectionMetadata>;

export interface IKernelSpecQuickPickItem<T extends KernelConnectionMetadata = KernelConnectionMetadata>
    extends QuickPickItem {
    selection: T;
}

export interface IKernel extends IAsyncDisposable {
    readonly connection: INotebookProviderConnection | undefined;
    readonly notebookDocument: NotebookDocument;
    /**;
     * In the case of Notebooks, this is the same as the Notebook Uri.
     * But in the case of Interactive Window, this is the Uri of the file (such as the Python file).
     * However if we create an intearctive window without a file, then this is undefined.
     */
    readonly resourceUri: Resource;
    readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>;
    readonly onStatusChanged: Event<KernelMessage.Status>;
    readonly onDisposed: Event<void>;
    readonly onStarted: Event<void>;
    readonly onRestarted: Event<void>;
    readonly onWillRestart: Event<void>;
    readonly onWillInterrupt: Event<void>;
    readonly onPreExecute: Event<NotebookCell>;
    readonly status: KernelMessage.Status;
    readonly disposed: boolean;
    readonly disposing: boolean;
    /**
     * Kernel information, used to save in ipynb in the metadata.
     * Crucial for non-python notebooks, else we save the incorrect information.
     */
    readonly info?: KernelMessage.IInfoReplyMsg['content'];
    readonly kernelSocket: Observable<KernelSocketInformation | undefined>;
    readonly session?: IJupyterSession;
    start(options?: { disableUI?: boolean }): Promise<void>;
    interrupt(): Promise<InterruptResult>;
    restart(): Promise<void>;
    executeCell(cell: NotebookCell): Promise<NotebookCellRunState>;
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
