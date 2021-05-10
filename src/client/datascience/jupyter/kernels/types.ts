// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { KernelMessage, Session } from '@jupyterlab/services';
import type { Observable } from 'rxjs/Observable';
import type {
    CancellationToken,
    Event,
    NotebookCell,
    NotebookController,
    NotebookDocument,
    QuickPickItem,
    Uri
} from 'vscode';
import type { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import type { IAsyncDisposable, Resource } from '../../../common/types';
import type { PythonEnvironment } from '../../../pythonEnvironments/info';
import type { IJupyterKernel, IJupyterKernelSpec, InterruptResult, KernelSocketInformation } from '../../types';

export type LiveKernelModel = IJupyterKernel & Partial<IJupyterKernelSpec> & { session: Session.IModel };

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
 * Connection metadata for Kernels started using default kernel.
 * Here we tell Jupyter to start a session and let it decide what kernel is to be started.
 * (could apply to either local or remote sessions when dealing with Jupyter Servers).
 */
export type DefaultKernelConnectionMetadata = Readonly<{
    /**
     * This will be empty as we do not have a kernel spec.
     * Left for type compatibility with other types that have kernel spec property.
     */
    kernelSpec?: IJupyterKernelSpec;
    /**
     * Python interpreter will be used for intellisense & the like.
     */
    interpreter?: PythonEnvironment;
    kind: 'startUsingDefaultKernel';
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
    | Readonly<PythonKernelConnectionMetadata>
    | Readonly<DefaultKernelConnectionMetadata>;

/**
 * Connection metadata for local kernels. Makes it easier to not have to check for the live connection type.
 */
export type LocalKernelConnectionMetadata =
    | Readonly<KernelSpecConnectionMetadata>
    | Readonly<PythonKernelConnectionMetadata>
    | Readonly<DefaultKernelConnectionMetadata>;

export interface IKernelSpecQuickPickItem<T extends KernelConnectionMetadata = KernelConnectionMetadata>
    extends QuickPickItem {
    selection: T;
}
export interface IKernelSelectionListProvider<T extends KernelConnectionMetadata = KernelConnectionMetadata> {
    getKernelSelections(resource: Resource, cancelToken?: CancellationToken): Promise<IKernelSpecQuickPickItem<T>[]>;
}

export interface IKernel extends IAsyncDisposable {
    readonly uri: Uri;
    readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>;
    readonly onStatusChanged: Event<ServerStatus>;
    readonly onDisposed: Event<void>;
    readonly onRestarted: Event<void>;
    readonly status: ServerStatus;
    readonly disposed: boolean;
    /**
     * Kernel information, used to save in ipynb in the metadata.
     * Crucial for non-python notebooks, else we save the incorrect information.
     */
    readonly info?: KernelMessage.IInfoReplyMsg['content'];
    readonly kernelSocket: Observable<KernelSocketInformation | undefined>;
    start(options?: { disableUI?: boolean; document: NotebookDocument }): Promise<void>;
    interrupt(document: NotebookDocument): Promise<InterruptResult>;
    restart(): Promise<void>;
    executeCell(cell: NotebookCell): Promise<void>;
    executeAllCells(document: NotebookDocument): Promise<void>;
}

export type KernelOptions = { metadata: KernelConnectionMetadata; controller: NotebookController };
export const IKernelProvider = Symbol('IKernelProvider');
export interface IKernelProvider extends IAsyncDisposable {
    /**
     * Event fired when the current kernel for a URI is changed.
     */
    readonly onKernelChanged: Event<void>;

    /**
     * Get hold of the active kernel for a given Uri (Notebook or other file).
     */
    get(uri: Uri): IKernel | undefined;
    /**
     * Gets or creates a kernel for a given Uri.
     * WARNING: If called with different options for same Uri, old kernel associated with the Uri will be disposed.
     */
    getOrCreate(uri: Uri, options: KernelOptions): IKernel | undefined;
}
