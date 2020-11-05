// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { KernelMessage } from '@jupyterlab/services';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import {
    CancellationToken,
    CancellationTokenSource,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookDocument,
    Uri
} from 'vscode';
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import { IAsyncDisposable, IDisposableRegistry } from '../../../common/types';
import { createDeferred, Deferred } from '../../../common/utils/async';
import {
    IDataScienceErrorHandler,
    IJupyterSession,
    INotebookEditorProvider,
    InterruptResult,
    IRawNotebookSupportedService,
    KernelSocketInformation
} from '../../types';
import { KernelExecution } from './kernelExecution';
import type { IKernel, IKernelProvider, IKernelSelectionUsage, KernelConnectionMetadata } from './types';

export abstract class BaseKernel implements IKernel, IAsyncDisposable {
    get onStatusChanged(): Event<ServerStatus> {
        return this._onStatusChanged.event;
    }
    get onRestarted(): Event<void> {
        return this._onRestarted.event;
    }
    get onDisposed(): Event<void> {
        return this._onDisposed.event;
    }
    get info(): KernelMessage.IInfoReplyMsg['content'] | undefined {
        return this._info;
    }
    get status(): ServerStatus {
        return this.getStatus();
    }
    get disposed(): boolean {
        return this.isDisposed();
    }
    get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket.asObservable();
    }
    protected _info?: KernelMessage.IInfoReplyMsg['content'];
    protected readonly _kernelSocket = new Subject<KernelSocketInformation | undefined>();
    protected readonly _onStatusChanged = new EventEmitter<ServerStatus>();
    protected readonly _onRestarted = new EventEmitter<void>();
    protected jupyterSession?: IJupyterSession;
    protected readonly _onDisposed = new EventEmitter<void>();
    protected restarting?: Deferred<void>;
    protected readonly kernelExecution: KernelExecution;
    protected startCancellation = new CancellationTokenSource();
    constructor(
        public readonly uri: Uri,
        public readonly metadata: Readonly<KernelConnectionMetadata>,
        protected readonly disposables: IDisposableRegistry,
        protected readonly launchTimeout: number,
        commandManager: ICommandManager,
        protected readonly errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        protected readonly kernelProvider: IKernelProvider,
        protected readonly kernelSelectionUsage: IKernelSelectionUsage,
        appShell: IApplicationShell,
        vscNotebook: IVSCodeNotebook,
        rawNotebookSupported: IRawNotebookSupportedService
    ) {
        this.kernelExecution = new KernelExecution(
            kernelProvider,
            commandManager,
            errorHandler,
            editorProvider,
            kernelSelectionUsage,
            appShell,
            vscNotebook,
            metadata,
            rawNotebookSupported
        );
    }
    public async executeCell(cell: NotebookCell): Promise<void> {
        await this.start({ disableUI: false, token: this.startCancellation.token });
        await this.kernelExecution.executeCell(cell);
    }
    public async executeAllCells(document: NotebookDocument): Promise<void> {
        await this.start({ disableUI: false, token: this.startCancellation.token });
        await this.kernelExecution.executeAllCells(document);
    }
    public async cancelCell(cell: NotebookCell) {
        this.startCancellation.cancel();
        await this.kernelExecution.cancelCell(cell);
    }
    public async cancelAllCells(document: NotebookDocument) {
        this.startCancellation.cancel();
        this.kernelExecution.cancelAllCells(document);
    }
    public async start(options?: { disableUI?: boolean; token?: CancellationToken }): Promise<void> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        await this.onStart(options);
    }
    public async interrupt(): Promise<InterruptResult> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this.jupyterSession) {
            throw new Error('No notebook to interrupt');
        }
        return this.onInterrupt();
    }
    public async dispose(): Promise<void> {
        this.restarting = undefined;
        if (this.jupyterSession) {
            await this.jupyterSession.dispose();
            this._onStatusChanged.fire(ServerStatus.Dead);
        }
        this.jupyterSession = undefined;
        this.kernelExecution.session = undefined;
        this.kernelExecution.loggers = undefined;
        this.kernelExecution.dispose();
        this._onDisposed.dispose();
        this._onRestarted.dispose();
        this._onStatusChanged.dispose();
        this._onDisposed.fire();
    }
    public async restart(): Promise<void> {
        if (this.restarting) {
            return this.restarting.promise;
        }
        if (this.jupyterSession) {
            this.restarting = createDeferred<void>();
            try {
                await this.onRestart();
                this.restarting.resolve();
            } catch (ex) {
                this.restarting.reject(ex);
            } finally {
                this.restarting = undefined;
            }
        }
    }
    protected abstract getStatus(): ServerStatus;
    protected abstract isDisposed(): boolean;
    protected abstract onStart(options?: { disableUI?: boolean; token?: CancellationToken }): Promise<void>;
    protected abstract onInterrupt(): Promise<InterruptResult>;

    protected abstract onRestart(): Promise<void>;
}
