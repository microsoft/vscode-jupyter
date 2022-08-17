// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { CancellationToken, Event } from 'vscode';
import { IAsyncDisposable, IDisplayOptions, IDisposable, Resource } from '../../platform/common/types';
import { IContributedKernelFinder } from '../internalTypes';
import {
    IKernelConnectionSession,
    KernelConnectionMetadata,
    LocalKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../types';

export const IKernelLauncher = Symbol('IKernelLauncher');
export interface IKernelLauncher {
    launch(
        kernelConnectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata,
        timeout: number,
        resource: Resource,
        workingDirectory: string,
        cancelToken: CancellationToken
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
    readonly kernelConnectionMetadata: Readonly<LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata>;
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

export interface ILocalKernelFinder extends IContributedKernelFinder {
    /**
     * Finds all kernel specs including Python.
     */
    listKernels(resource: Resource, cancelToken?: CancellationToken): Promise<LocalKernelConnectionMetadata[]>;
}

/**
 * The daemon responsible for the Python Kernel.
 */
export interface IPythonKernelDaemon extends IDisposable {
    interrupt(): Promise<void>;
    kill(): Promise<void>;
}

// Provides a service to determine if raw notebook is supported or not
export const IRawNotebookSupportedService = Symbol('IRawNotebookSupportedService');
export interface IRawNotebookSupportedService {
    isSupported: boolean;
}

// Provides notebooks that talk directly to kernels as opposed to a jupyter server
export const IRawNotebookProvider = Symbol('IRawNotebookProvider');
export interface IRawNotebookProvider extends IAsyncDisposable {
    isSupported: boolean;
    createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        ui: IDisplayOptions,
        cancelToken: CancellationToken
    ): Promise<IKernelConnectionSession>;
}
