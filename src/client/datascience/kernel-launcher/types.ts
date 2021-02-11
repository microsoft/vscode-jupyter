// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import { SpawnOptions } from 'child_process';
import { CancellationToken, Event } from 'vscode';
import { WrappedError } from '../../common/errors/errorUtils';
import { ObservableExecutionResult } from '../../common/process/types';
import { IAsyncDisposable, IDisposable, Resource } from '../../common/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { KernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../jupyter/kernels/types';
import { IJupyterKernelSpec, KernelInterpreterDependencyResponse } from '../types';

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
    interrupt(): Promise<void>;
}

export const IKernelFinder = Symbol('IKernelFinder');
export interface IKernelFinder {
    findKernelSpec(
        resource: Resource,
        option?: nbformat.INotebookMetadata | PythonEnvironment,
        _cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined>;
    listKernelSpecs(resource: Resource): Promise<IJupyterKernelSpec[]>;
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

export class KernelDiedError extends WrappedError {
    constructor(message: string, public readonly stdErr: string, originalException?: Error) {
        super(message, originalException);
    }
}

export class KernelProcessExited extends Error {
    constructor(public readonly exitCode: number = -1) {
        super('Kernel process Exited');
    }
}

export class PythonKernelDiedError extends Error {
    public readonly exitCode: number;
    public readonly reason?: string;
    public readonly stdErr?: string;
    constructor(options: { exitCode: number; reason?: string; stdErr: string } | { error: Error; stdErr: string }) {
        const message =
            'exitCode' in options
                ? `Kernel died with exit code ${options.exitCode}. ${options.reason}`
                : `Kernel died ${options.error.message}`;
        super(message);
        this.stdErr = options.stdErr;
        if ('exitCode' in options) {
            this.exitCode = options.exitCode;
            this.reason = options.reason;
        } else {
            this.exitCode = -1;
            this.reason = options.error.message;
            this.stack = options.error.stack;
            this.name = options.error.name;
        }
    }
}

export class IpyKernelNotInstalledError extends Error {
    constructor(message: string, public reason: KernelInterpreterDependencyResponse) {
        super(message);
    }
}
