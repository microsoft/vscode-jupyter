// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { KernelMessage, Session } from '@jupyterlab/services';
import type { Observable } from 'rxjs/Observable';
import type { CancellationToken, Event, QuickPickItem, Uri } from 'vscode';
import { NotebookCell, NotebookDocument } from '../../../../../types/vscode-proposed';
import type { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import type { IAsyncDisposable, Resource } from '../../../common/types';
import type { PythonEnvironment } from '../../../pythonEnvironments/info';
import type {
    IJupyterKernel,
    IJupyterKernelSpec,
    IJupyterSessionManager,
    InterruptResult,
    KernelSocketInformation
} from '../../types';
import { isPythonKernelConnection } from './helpers';

export type LiveKernelModel = IJupyterKernel & Partial<IJupyterKernelSpec> & { session: Session.IModel };

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
}>;
/**
 * Connection metadata for Kernels started using Python interpreter.
 * These are not necessarily raw (it could be plain old Jupyter Kernels, where we register Python interpreter as a kernel).
 * We can have KernelSpec information here as well, however that is totally optional.
 * We will always start this kernel using old Jupyter style (provided we first register this intrepreter as a kernel) or raw.
 */
export type PythonKernelConnectionMetadata = Readonly<{
    kernelSpec?: IJupyterKernelSpec;
    interpreter: PythonEnvironment;
    kind: 'startUsingPythonInterpreter';
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
 * Returns a string that can be used to uniquely identify a Kernel Connection.
 */
export function getKernelConnectionId(kernelConnection: KernelConnectionMetadata) {
    switch (kernelConnection.kind) {
        case 'connectToLiveKernel':
            return `${kernelConnection.kind}#${kernelConnection.kernelModel.name}.${kernelConnection.kernelModel.session.id}.${kernelConnection.kernelModel.session.name}`;
        case 'startUsingDefaultKernel':
            return `${kernelConnection.kind}#${kernelConnection}`;
        case 'startUsingKernelSpec':
            // 1. kernelSpec.interpreterPath added by kernel finder.
            // Helps us identify what interpreter a kernel belongs to.
            // 2. kernelSpec.metadata?.interpreter?.path added by old approach of starting kernels (jupyter).
            // When we register an interpreter as a kernel, then we store that interpreter info into metadata.
            // 3. kernelConnection.interpreter
            // This contains the resolved interpreter (using 1 & 2).

            // We need to take the interpreter path into account, as its possible
            // a user has registered a kernel with the same name in two different interpreters.
            let interpreterPath = isPythonKernelConnection(kernelConnection)
                ? kernelConnection.interpreter?.path ||
                  kernelConnection.kernelSpec.interpreterPath ||
                  kernelConnection.kernelSpec.metadata?.interpreter?.path ||
                  ''
                : '';

            // Paths on windows can either contain \ or / Both work.
            // Thus, C:\Python.exe is the same as C:/Python.exe
            // In the kernelspec.json we could have paths in argv such as C:\\Python.exe or C:/Python.exe.
            interpreterPath = interpreterPath.replace(/\\/g, '/');

            return `${kernelConnection.kind}#${kernelConnection.kernelSpec.name}.${
                kernelConnection.kernelSpec.display_name
            }${(kernelConnection.kernelSpec.argv || []).join(' ').replace(/\\/g, '/')}${interpreterPath}`;
        case 'startUsingPythonInterpreter':
            // Paths on windows can either contain \ or / Both work.
            // Thus, C:\Python.exe is the same as C:/Python.exe
            return `${kernelConnection.kind}#${kernelConnection.interpreter.path.replace(/\\/g, '/')}`;
        default:
            throw new Error(`Unsupported Kernel Connection ${kernelConnection}`);
    }
}

export interface IKernelSpecQuickPickItem<T extends KernelConnectionMetadata = KernelConnectionMetadata>
    extends QuickPickItem {
    selection: T;
}
export interface IKernelSelectionListProvider<T extends KernelConnectionMetadata = KernelConnectionMetadata> {
    getKernelSelections(resource: Resource, cancelToken?: CancellationToken): Promise<IKernelSpecQuickPickItem<T>[]>;
}

export interface IKernelSelectionUsage {
    /**
     * Given a kernel selection, this method will attempt to use that kernel and return the corresponding Interpreter, Kernel Spec and the like.
     * This method will also check if required dependencies are installed or not, and will install them if required.
     */
    useSelectedKernel(
        selection: KernelConnectionMetadata,
        resource: Resource,
        type: 'raw' | 'jupyter' | 'noConnection',
        session?: IJupyterSessionManager,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<KernelConnectionMetadata | undefined>;
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
    start(options?: { disableUI?: boolean }): Promise<void>;
    interrupt(document: NotebookDocument): Promise<InterruptResult>;
    restart(): Promise<void>;
    executeCell(cell: NotebookCell): Promise<void>;
    executeAllCells(document: NotebookDocument): Promise<void>;
}

export type KernelOptions = { metadata: KernelConnectionMetadata };
export const IKernelProvider = Symbol('IKernelProvider');
export interface IKernelProvider extends IAsyncDisposable {
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
