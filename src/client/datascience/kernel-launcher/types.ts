// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type * as nbformat from '@jupyterlab/nbformat';
import { SpawnOptions } from 'child_process';
import { CancellationToken, Event } from 'vscode';
import { ObservableExecutionResult } from '../../common/process/types';
import { IAsyncDisposable, IDisposable, Resource } from '../../common/types';
import {
    KernelConnectionMetadata,
    KernelSpecConnectionMetadata,
    LocalKernelConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../jupyter/kernels/types';
import { INotebookProviderConnection } from '../types';

export const IKernelLauncher = Symbol('IKernelLauncher');
export interface IKernelLauncher {
    launch(
        kernelConnectionMetadata: KernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        timeout: number,
        resource: Resource,
        workingDirectory: string,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<IKernelProcess>;
}

export interface IKernelConnection {
    iopub_port: number;
    shell_port: number;
    stdin_port: number;
    control_port: number;
    signature_scheme: 'hmac-sha256';
    hb_port: number;
    ip: string;
    key: string;
    transport: 'tcp' | 'ipc';
    kernel_name?: string;
}

export interface IKernelProcess extends IAsyncDisposable {
    readonly connection: Readonly<IKernelConnection>;
    readonly kernelConnectionMetadata: Readonly<KernelSpecConnectionMetadata | PythonKernelConnectionMetadata>;
    /**
     * This event is triggered if the process is exited
     */
    readonly exited: Event<{ exitCode?: number; reason?: string }>;
    /**
     * Whether we can interrupt this kernel process.
     * If not possible, send a shell message to the underlying kernel.
     */
    readonly canInterrupt: boolean;
    /**
     * Interrupts the Kernel process.
     * This method is to be used only if `canInterrupt` is true.
     */
    interrupt(): Promise<void>;
}

export const ILocalKernelFinder = Symbol('ILocalKernelFinder');
export interface ILocalKernelFinder {
    findKernel(
        resource: Resource,
        option?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken
    ): Promise<LocalKernelConnectionMetadata | undefined>;
    listNonPythonKernels(
        cancelToken?: CancellationToken,
        useCache?: 'useCache' | 'ignoreCache'
    ): Promise<LocalKernelConnectionMetadata[]>;
    listKernels(
        resource: Resource,
        cancelToken?: CancellationToken,
        useCache?: 'useCache' | 'ignoreCache'
    ): Promise<LocalKernelConnectionMetadata[]>;
    getKernelSpecRootPath(): Promise<string | undefined>;
}

export const IRemoteKernelFinder = Symbol('IRemoteKernelFinder');
export interface IRemoteKernelFinder {
    findKernel(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        option?: nbformat.INotebookMetadata,
        cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata | undefined>;
    listKernels(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
        cancelToken?: CancellationToken
    ): Promise<KernelConnectionMetadata[]>;
}
/**
 * The daemon responsible for the Python Kernel.
 */
export interface IPythonKernelDaemon extends IDisposable {
    interrupt(): Promise<void>;
    kill(): Promise<void>;
    preWarm(): Promise<void>;
    start(moduleName: string, args: string[], options: SpawnOptions): Promise<ObservableExecutionResult<string>>;
}
