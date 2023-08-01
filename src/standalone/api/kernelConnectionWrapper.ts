// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel } from '@jupyterlab/services';
import { IDisposable } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { BaseKernelConnectionWrapper } from '../../kernels/jupyter/baseKernelConnectionWrapper';
import { IBaseKernel } from '../../kernels/types';

/**
 * Wrapper around an IKernelConnection that is exposed to 3rd parties. Allows us to change the underlying connection without exposing it to the 3rd party (like on a restart)
 */
export class KernelConnectionWrapper extends BaseKernelConnectionWrapper {
    /**
     * Use `kernelConnection` to access the value as its not a constant (can change over time).
     * E.g. when restarting kernels or the like.
     */
    private _kernelConnection!: Kernel.IKernelConnection;
    protected get possibleKernelConnection(): undefined | Kernel.IKernelConnection {
        if (this.kernel.session?.kernel === this._kernelConnection) {
            return this._kernelConnection;
        }
        this.stopHandlingKernelMessages(this._kernelConnection);
        if (this.kernel.session?.kernel) {
            this.startHandleKernelMessages(this.kernel.session.kernel);
            return this._kernelConnection;
        }
    }

    constructor(
        readonly kernel: IBaseKernel,
        disposables: IDisposable[]
    ) {
        super(kernel.session!.kernel!, disposables);
        const emiStatusChangeEvents = () => {
            this.statusChanged.emit(kernel.status);
            if (kernel.status === 'dead' && !kernel.disposed && !kernel.disposing) {
                this.connectionStatusChanged.emit('disconnected');
            }
        };
        kernel.onDisposed(
            () => {
                // this._isRestarting = false;
                emiStatusChangeEvents();
                this.disposed.emit();
            },
            this,
            disposables
        );
        kernel.onStarted(emiStatusChangeEvents, this, disposables);
        kernel.onRestarted(emiStatusChangeEvents, this, disposables);
        kernel.onStatusChanged(emiStatusChangeEvents, this, disposables);
        this.startHandleKernelMessages(kernel.session!.kernel!);
    }
    async shutdown(): Promise<void> {
        if (
            this.kernel.kernelConnectionMetadata.kind === 'startUsingRemoteKernelSpec' ||
            this.kernel.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel'
        ) {
            await this.kernel.session?.shutdown();
        }
        await this.kernel.dispose();
    }
    dispose(): void {
        this.kernel.dispose().catch(noop);
    }
    async interrupt(): Promise<void> {
        // Sometimes we end up starting a new session.
        // Hence assume a new session was created, meaning we need to bind to the kernel connection all over again.
        this.stopHandlingKernelMessages(this.possibleKernelConnection!);

        await this.kernel.interrupt();

        if (!this.kernel.session?.kernel) {
            throw new Error('Restart failed');
        }
        this.startHandleKernelMessages(this.kernel.session.kernel);
    }
    async restart(): Promise<void> {
        if (this.possibleKernelConnection) {
            this.stopHandlingKernelMessages(this.possibleKernelConnection);
        }

        // If this is a remote, then we do something special.
        await this.kernel.restart();

        if (!this.kernel.session?.kernel) {
            throw new Error('Restart failed');
        }
        this.startHandleKernelMessages(this.kernel.session.kernel);
    }
    protected override startHandleKernelMessages(kernelConnection: Kernel.IKernelConnection) {
        this._kernelConnection = kernelConnection;
        super.startHandleKernelMessages(kernelConnection);
    }
}
