// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel } from '@jupyterlab/services';
import { IDisposable } from '../../platform/common/types';
import { BaseKernelConnectionWrapper } from '../jupyter/baseKernelConnectionWrapper';

/**
 * Wrapper around an IKernelConnection that's exposed to 3rd parties.
 */
export class KernelConnectionWrapper extends BaseKernelConnectionWrapper {
    /**
     * Use `kernelConnection` to access the value as its not a constant (can change over time).
     * E.g. when restarting kernels or the like.
     */
    private _kernelConnection!: Kernel.IKernelConnection;
    protected get possibleKernelConnection(): undefined | Kernel.IKernelConnection {
        return this._kernelConnection;
    }
    public get kernel() {
        return this._kernelConnection;
    }

    constructor(kernel: Kernel.IKernelConnection, disposables: IDisposable[]) {
        super(kernel, disposables);
        this._kernelConnection = kernel;
    }
    public changeKernel(kernel: Kernel.IKernelConnection) {
        if (this.kernel === kernel) {
            return;
        }
        this.stopHandlingKernelMessages(this.possibleKernelConnection!);
        this._kernelConnection = kernel;
        this.startHandleKernelMessages(kernel);
    }
    async shutdown(): Promise<void> {
        await this._kernelConnection.shutdown();
    }
    dispose(): void {
        this._kernelConnection.dispose();
    }
    async interrupt(): Promise<void> {
        await this._kernelConnection.interrupt();
    }
    async restart(): Promise<void> {
        await this._kernelConnection.restart();
    }
    protected override startHandleKernelMessages(kernelConnection: Kernel.IKernelConnection) {
        super.startHandleKernelMessages(kernelConnection);
        this._kernelConnection = kernelConnection;
        kernelConnection.connectionStatusChanged.connect(this.onConnectionStatusChanged, this);
        kernelConnection.statusChanged.connect(this.onStatusChanged, this);
        kernelConnection.disposed.connect(this.onDisposed, this);
    }
    protected override stopHandlingKernelMessages(kernelConnection: Kernel.IKernelConnection): void {
        super.stopHandlingKernelMessages(kernelConnection);
        kernelConnection.connectionStatusChanged.disconnect(this.onConnectionStatusChanged, this);
        kernelConnection.statusChanged.disconnect(this.onStatusChanged, this);
        kernelConnection.disposed.disconnect(this.onDisposed, this);
    }
    private onDisposed(connection: Kernel.IKernelConnection) {
        if (connection === this.possibleKernelConnection) {
            this.disposed.emit();
        }
    }
    private onStatusChanged(connection: Kernel.IKernelConnection, args: Kernel.Status) {
        if (connection === this.possibleKernelConnection) {
            this.statusChanged.emit(args);
        }
    }
    private onConnectionStatusChanged(connection: Kernel.IKernelConnection, args: Kernel.ConnectionStatus) {
        if (connection === this.possibleKernelConnection) {
            this.connectionStatusChanged.emit(args);
        }
    }
}
