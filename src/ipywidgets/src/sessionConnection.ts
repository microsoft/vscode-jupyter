// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IChangedArgs } from '@jupyterlab/coreutils';
import { Kernel } from '@jupyterlab/services';
import { ISessionConnection } from '@jupyterlab/services/lib/session/session';
import { ISignal } from '@lumino/signaling';
import { uuid } from '@jupyter-widgets/base';

export class SessionConnection implements ISessionConnection {
    private _id = uuid();
    constructor(public readonly kernel: Kernel.IKernelConnection) {}
    propertyChanged: ISignal<this, 'path' | 'name' | 'type'>;
    kernelChanged: ISignal<this, IChangedArgs<Kernel.IKernelConnection, Kernel.IKernelConnection, 'kernel'>>;
    public get statusChanged() {
        return this.kernel.statusChanged as any;
    }
    public get connectionStatusChanged() {
        return this.kernel.connectionStatusChanged as any;
    }
    public get iopubMessage() {
        return this.kernel.iopubMessage as any;
    }
    public get unhandledMessage() {
        return this.kernel.unhandledMessage as any;
    }
    public get anyMessage() {
        return this.kernel.anyMessage as any;
    }
    public get id() {
        return this._id;
    }
    public get path() {
        return ''; // This would be the path to the notebook file
    }
    public get name() {
        return this.kernel.name;
    }
    public get type() {
        return 'notebook';
    }
    public get serverSettings() {
        return this.kernel.serverSettings;
    }
    public get model() {
        return {
            id: this._id,
            name: this.name,
            path: '',
            type: 'notebook',
            kernel: this.kernel.model
        };
    }
    public setPath(_path: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public setName(_name: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    setType(_type: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    changeKernel(_options: Partial<Kernel.IModel>): Promise<Kernel.IKernelConnection> {
        throw new Error('Method not implemented.');
    }
    shutdown(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public get disposed() {
        return this.kernel.disposed as any;
    }
    public get isDisposed() {
        return this.kernel.isDisposed;
    }
    public dispose(): void {
        // Don't actually dispose. We control disposal
    }
}
