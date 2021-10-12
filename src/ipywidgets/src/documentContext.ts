// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IChangedArgs } from '@jupyterlab/coreutils';
import { ISessionContext } from '@jupyterlab/apputils';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { INotebookModel, NotebookModel } from '@jupyterlab/notebook/lib';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Contents, Kernel } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';
import { Signal } from './signal';
import * as KernelSpec from '@jupyterlab/services/lib/kernelspec/kernelspec';
import { ISessionConnection, IManager } from '@jupyterlab/services/lib/session/session';
import { ISignal } from '@lumino/signaling';
import { SessionConnection } from './sessionConnection';

type IKernelChangedArgs = IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>;

// tslint:disable: no-any
export class DocumentContext implements DocumentRegistry.IContext<INotebookModel>, ISessionContext {
    public pathChanged = new Signal<this, string>();
    public fileChanged = new Signal<this, Contents.IModel>();
    public saveState = new Signal<this, DocumentRegistry.SaveState>();
    public disposed = new Signal<this, void>();
    public model: INotebookModel;
    public sessionContext: ISessionContext = this;
    private sessionConnection: ISessionConnection;
    public path: string;
    public localPath: string;
    public contentsModel: Contents.IModel;
    public urlResolver: IRenderMime.IResolver;
    public isReady: boolean;
    public ready: Promise<void>;
    public isDisposed: boolean;
    public terminated = new Signal<this, void>();
    public kernelChanged = new Signal<this, IKernelChangedArgs>();
    public sessionChanged = new Signal<this, IChangedArgs<ISessionConnection, ISessionConnection, 'session'>>();
    public propertyChanged = new Signal<this, 'path' | 'name' | 'type'>();
    public name: string;
    public type: string;
    constructor(public kernel: Kernel.IKernelConnection) {
        // We are the session context

        // Create a 'session connection' from the kernel
        this.sessionConnection = new SessionConnection(this.kernel);

        // Generate a dummy notebook model
        this.model = new NotebookModel();
    }
    public rename(_newName: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public download(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public get session(): ISessionConnection {
        return this.sessionConnection;
    }
    public initialize(): Promise<boolean> {
        throw new Error('Method not implemented.');
    }
    public get isTerminating(): boolean {
        return this.kernel.status == 'terminating';
    }
    public get isRestarting(): boolean {
        return this.kernel.status == 'restarting' || this.kernel.status == 'autorestarting';
    }
    public get connectionStatusChanged(): ISignal<this, Kernel.ConnectionStatus> {
        return this.kernel.connectionStatusChanged as any;
    }
    public get statusChanged() {
        return this.kernel.statusChanged as any;
    }
    public get iopubMessage() {
        return this.kernel.iopubMessage as any;
    }
    public get unhandledMessage() {
        return this.kernel.unhandledMessage as any;
    }
    public get status(): Kernel.Status {
        return this.kernel.status;
    }
    public get kernelPreference(): ISessionContext.IKernelPreference {
        return {
            name: this.kernel.name
        };
    }
    public get kernelDisplayName(): string {
        return this.kernel.name;
    }

    public get hasNoKernel(): boolean {
        return false;
    }
    public get kernelDisplayStatus(): ISessionContext.KernelDisplayStatus {
        return this.status;
    }
    public get prevKernelName(): string {
        return this.kernel.name;
    }
    public get sessionManager(): IManager {
        throw new Error('Method not implemented.');
    }
    public get specsManager(): KernelSpec.IManager {
        throw new Error('Method not implemented.');
    }
    public restartKernel(): Promise<void> {
        throw new Error('Method not implemented.');
    }

    public changeKernel(_options: Partial<Kernel.IModel>): Promise<Kernel.IKernelConnection> {
        throw new Error('Method not implemented.');
    }
    public shutdown(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public selectKernel(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public restart(): Promise<boolean> {
        throw new Error('Method not implemented.');
    }
    public setPath(_path: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public setName(_name: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public setType(_type: string): Promise<void> {
        throw new Error('Method not implemented.');
    }

    public addSibling(_widget: Widget, _options?: any): any {
        throw new Error('Method not implemented.');
    }
    public save(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public saveAs(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public revert(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public createCheckpoint(): Promise<import('@jupyterlab/services').Contents.ICheckpointModel> {
        throw new Error('Method not implemented.');
    }
    public deleteCheckpoint(_checkpointID: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public restoreCheckpoint(_checkpointID?: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    public listCheckpoints(): Promise<import('@jupyterlab/services').Contents.ICheckpointModel[]> {
        throw new Error('Method not implemented.');
    }
    public dispose(): void {
        throw new Error('Method not implemented.');
    }
}
