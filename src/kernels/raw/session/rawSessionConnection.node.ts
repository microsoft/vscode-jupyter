// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage, ServerConnection, Session } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
import uuid from 'uuid/v4';
import { traceInfoIfCI, traceWarning } from '../../../platform/logging';
import { Resource } from '../../../platform/common/types';
import { Telemetry } from '../../../telemetry';
import { INewSessionWithSocket, KernelSocketInformation, LocalKernelConnectionMetadata } from '../../types';
import { IKernelLauncher } from '../types';
import { sendKernelTelemetryEvent } from '../../telemetry/sendKernelTelemetryEvent';
import { noop } from '../../../platform/common/utils/misc';
import { getNameOfKernelConnection } from '../../helpers';
import { CancellationToken, Uri } from 'vscode';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import { RawKernelConnection } from './rawKernelConnection.node';
import { IJupyterRequestCreator } from '../../jupyter/types';

/*
RawSession class implements a jupyterlab ISession object
This provides enough of the ISession interface so that our direct
ZMQ Kernel connection can pretend to be a jupyterlab Session
*/
export class RawSessionConnection implements INewSessionWithSocket {
    public isDisposed: boolean = false;
    public readonly id: string;
    public readonly path: string;
    public readonly name: string;
    private readonly _kernel: RawKernelConnection;
    public readonly statusChanged = new Signal<this, KernelMessage.Status>(this);
    public readonly kernelChanged = new Signal<this, Session.ISessionConnection.IKernelChangedArgs>(this);
    public readonly terminated = new Signal<this, void>(this);
    public readonly iopubMessage = new Signal<this, KernelMessage.IIOPubMessage>(this);
    public readonly unhandledMessage = new Signal<this, KernelMessage.IMessage>(this);
    public readonly anyMessage = new Signal<this, Kernel.IAnyMessageArgs>(this);
    public readonly disposed = new Signal<this, void>(this);
    public readonly pendingInput = new Signal<this, boolean>(this);
    public readonly connectionStatusChanged = new Signal<this, Kernel.ConnectionStatus>(this);
    public readonly propertyChanged = new Signal<this, 'path' | 'name' | 'type'>(this);
    private _jupyterLabServices?: typeof import('@jupyterlab/services');
    private cellExecutedSuccessfully?: boolean;
    private _didShutDownOnce = false;
    private _isDisposing?: boolean;
    public get atleastOneCellExecutedSuccessfully() {
        return this.cellExecutedSuccessfully === true;
    }
    private get jupyterLabServices() {
        if (!this._jupyterLabServices) {
            // Lazy load jupyter lab for faster extension loading.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._jupyterLabServices = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
        }
        return this._jupyterLabServices;
    }

    public get connectionStatus() {
        return this._kernel?.connectionStatus || 'disconnected';
    }
    get serverSettings(): ServerConnection.ISettings {
        // We do not expect anyone to use this. Hence return a setting thats now expected to work, but at least compiles.
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
        return jupyterLab.ServerConnection.makeSettings({
            wsUrl: 'RAW'
        });
    }
    get model(): Session.IModel {
        return {
            id: this.id,
            name: this.name,
            path: this.path,
            type: 'notebook',
            kernel: {
                id: this._kernel?.id,
                name: this.name
            }
        };
    }
    private isTerminating?: boolean;
    get status(): KernelMessage.Status {
        if (this.isDisposed) {
            return 'dead';
        }
        if (this.isTerminating) {
            return 'terminating';
        }
        return this.kernel?.status ?? 'unknown';
    }

    isRemoteSession?: boolean | undefined;

    // RawSession owns the lifetime of the kernel process and will dispose it
    // Return the current kernel for this session
    get kernel(): Kernel.IKernelConnection | null {
        return this._kernel as Kernel.IKernelConnection | null;
    }

    get kernelSocketInformation(): KernelSocketInformation {
        return {
            socket: this._kernel.socket,
            options: {
                id: this._kernel.id,
                clientId: this._kernel.clientId,
                userName: this._kernel.username,
                model: this._kernel.model
            }
        };
    }

    constructor(
        private readonly resource: Resource,
        kernelLauncher: IKernelLauncher,
        workingDirectory: Uri,
        private readonly kernelConnectionMetadata: LocalKernelConnectionMetadata,
        launchTimeout: number,
        public readonly type: 'notebook' | 'console',
        requestCreator: IJupyterRequestCreator
    ) {
        // Unique ID for this session instance
        this.id = uuid();
        this.name = getNameOfKernelConnection(this.kernelConnectionMetadata) || 'python3';
        this.path = this.resource?.fsPath || this.kernelConnectionMetadata.interpreter?.uri.fsPath || 'kernel_path';
        // ID for our client JMP connection
        this._kernel = new RawKernelConnection(
            resource,
            kernelLauncher,
            workingDirectory,
            launchTimeout,
            kernelConnectionMetadata,
            requestCreator
        );
        this._kernel.statusChanged.connect(this.onKernelStatus, this);
        this._kernel.iopubMessage.connect(this.onIOPubMessage, this);
        this._kernel.connectionStatusChanged.connect(this.onKernelConnectionStatus, this);
        this._kernel.unhandledMessage.connect(this.onUnhandledMessage, this);
        this._kernel.anyMessage.connect(this.onAnyMessage, this);
        this._kernel.disposed.connect(this.onDisposed, this);
        this._kernel.pendingInput.connect(this.onPendingInput, this);
    }
    public async startKernel(options: { token: CancellationToken }): Promise<void> {
        await trackKernelResourceInformation(this.resource, { kernelConnection: this.kernelConnectionMetadata });
        await this._kernel.start(options.token);
    }
    public dispose() {
        this._isDisposing = true;
        // We want to know who called dispose on us
        const stacktrace = new Error().stack;
        sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionDisposed, undefined, { stacktrace });

        // Since we're disposing, we don't want to be notified of any more messages, hence this can be done early.
        try {
            this._kernel.statusChanged.disconnect(this.onKernelStatus, this);
            this._kernel.iopubMessage.disconnect(this.onIOPubMessage, this);
            this._kernel.connectionStatusChanged.disconnect(this.onKernelConnectionStatus, this);
            this._kernel.unhandledMessage.disconnect(this.onUnhandledMessage, this);
            this._kernel.anyMessage.disconnect(this.onAnyMessage, this);
            this._kernel.disposed.disconnect(this.onDisposed, this);
            this._kernel.pendingInput.disconnect(this.onPendingInput, this);
        } catch {
            //
        }

        // Now actually dispose ourselves
        this.shutdown()
            .catch(noop)
            .finally(() => {
                this._kernel.dispose();
                this.isDisposed = true;
                this.disposed.emit();
                Signal.disconnectAll(this);
            });
    }
    // Shutdown our session and kernel
    public async shutdown(): Promise<void> {
        if (this._didShutDownOnce) {
            return;
        }
        this._didShutDownOnce = true;
        this.isTerminating = true;
        this.statusChanged.emit('terminating');
        await this._kernel
            .shutdown()
            .catch((ex) => traceWarning(`Failed to shutdown kernel, ${this.kernelConnectionMetadata.id}`, ex));
        this.isTerminating = false;
        // Before triggering any status events ensure this is marked as disposed.
        if (this._isDisposing) {
            this.isDisposed = true;
        }
        this.terminated.emit();
        this.statusChanged.emit(this.status);
    }
    private onKernelStatus(_sender: Kernel.IKernelConnection, state: KernelMessage.Status) {
        traceInfoIfCI(`RawSession status changed to ${state}`);
        this.statusChanged.emit(state);
    }

    public setPath(_path: string): Promise<void> {
        throw new Error('Not yet implemented');
    }
    public setName(_name: string): Promise<void> {
        throw new Error('Not yet implemented');
    }
    public setType(_type: string): Promise<void> {
        throw new Error('Not yet implemented');
    }
    public changeKernel(_options: Partial<Kernel.IModel>): Promise<Kernel.IKernelConnection> {
        throw new Error('Not yet implemented');
    }

    // Private
    // Send out a message when our kernel changes state
    private onIOPubMessage(_sender: Kernel.IKernelConnection, msg: KernelMessage.IIOPubMessage) {
        if (
            !this.cellExecutedSuccessfully &&
            msg.header.msg_type === 'execute_result' &&
            msg.content &&
            (this.jupyterLabServices.KernelMessage.isExecuteResultMsg(msg) ||
                this.jupyterLabServices.KernelMessage.isExecuteInputMsg(msg)) &&
            msg.content.execution_count
        ) {
            this.cellExecutedSuccessfully = true;
        }
        this.iopubMessage.emit(msg);
    }
    private onAnyMessage(_sender: Kernel.IKernelConnection, msg: Kernel.IAnyMessageArgs) {
        this.anyMessage.emit(msg);
    }
    private onUnhandledMessage(_sender: Kernel.IKernelConnection, msg: KernelMessage.IMessage) {
        this.unhandledMessage.emit(msg);
    }
    private onKernelConnectionStatus(_sender: Kernel.IKernelConnection, state: Kernel.ConnectionStatus) {
        this.connectionStatusChanged.emit(state);
    }
    private onDisposed(_sender: Kernel.IKernelConnection) {
        this.disposed.emit();
    }
    private onPendingInput(_sender: Kernel.IKernelConnection, msg: boolean) {
        this.pendingInput.emit(msg);
    }
}
