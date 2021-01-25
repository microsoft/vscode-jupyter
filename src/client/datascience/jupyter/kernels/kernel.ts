// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { KernelMessage } from '@jupyterlab/services';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import * as uuid from 'uuid/v4';
import { CancellationTokenSource, Event, EventEmitter, NotebookCell, NotebookDocument, Uri } from 'vscode';
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import { WrappedError } from '../../../common/errors/errorUtils';
import { traceError, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IDisposableRegistry, IExtensionContext } from '../../../common/types';
import { createDeferred, Deferred } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { sendTelemetryEvent } from '../../../telemetry';
import { CodeSnippets, Telemetry } from '../../constants';
import {
    IDataScienceErrorHandler,
    INotebook,
    INotebookEditorProvider,
    INotebookProvider,
    INotebookProviderConnection,
    InterruptResult,
    IRawNotebookSupportedService,
    KernelSocketInformation
} from '../../types';
import { isPythonKernelConnection } from './helpers';
import { KernelExecution } from './kernelExecution';
import type { IKernel, IKernelProvider, IKernelSelectionUsage, KernelConnectionMetadata } from './types';

export class Kernel implements IKernel {
    get connection(): INotebookProviderConnection | undefined {
        return this.notebook?.connection;
    }
    get onStatusChanged(): Event<ServerStatus> {
        return this._onStatusChanged.event;
    }
    get onRestarted(): Event<void> {
        return this._onRestarted.event;
    }
    get onDisposed(): Event<void> {
        return this._onDisposed.event;
    }
    get onInterruptTimedOut(): Event<void> {
        return this._onInterruptTimedOut.event;
    }
    private _info?: KernelMessage.IInfoReplyMsg['content'];
    get info(): KernelMessage.IInfoReplyMsg['content'] | undefined {
        return this._info;
    }
    get status(): ServerStatus {
        return this.notebook?.status ?? ServerStatus.NotStarted;
    }
    get disposed(): boolean {
        return this._disposed === true || this.notebook?.disposed === true;
    }
    get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket.asObservable();
    }
    private notebook?: INotebook;
    private _disposed?: boolean;
    private isRawNotebookSupported?: Promise<boolean>;
    private readonly _kernelSocket = new Subject<KernelSocketInformation | undefined>();
    private readonly _onStatusChanged = new EventEmitter<ServerStatus>();
    private readonly _onRestarted = new EventEmitter<void>();
    private readonly _onDisposed = new EventEmitter<void>();
    private readonly _onInterruptTimedOut = new EventEmitter<void>();
    private _notebookPromise?: Promise<INotebook>;
    private readonly hookedNotebookForEvents = new WeakSet<INotebook>();
    private restarting?: Deferred<void>;
    private readonly kernelValidated = new Map<string, { kernel: IKernel; promise: Promise<void> }>();
    private readonly kernelExecution: KernelExecution;
    private startCancellation = new CancellationTokenSource();
    constructor(
        public readonly uri: Uri,
        public readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        private readonly notebookProvider: INotebookProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly launchTimeout: number,
        private readonly interruptTimeout: number,
        commandManager: ICommandManager,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        private readonly kernelProvider: IKernelProvider,
        private readonly kernelSelectionUsage: IKernelSelectionUsage,
        appShell: IApplicationShell,
        vscNotebook: IVSCodeNotebook,
        private readonly rawNotebookSupported: IRawNotebookSupportedService,
        private readonly fs: IFileSystem,
        context: IExtensionContext
    ) {
        this.kernelExecution = new KernelExecution(
            kernelProvider,
            commandManager,
            errorHandler,
            editorProvider,
            kernelSelectionUsage,
            appShell,
            vscNotebook,
            kernelConnectionMetadata,
            rawNotebookSupported,
            context
        );
    }
    public async executeCell(cell: NotebookCell): Promise<void> {
        const notebookPromise = this.startNotebook({ disableUI: false });
        await this.kernelExecution.executeCell(notebookPromise, cell);
    }
    public async executeAllCells(document: NotebookDocument): Promise<void> {
        const notebookPromise = this.startNotebook({ disableUI: false });
        await this.kernelExecution.executeAllCells(notebookPromise, document);
    }
    public async cancelCell(cell: NotebookCell) {
        this.startCancellation.cancel();
        await this.kernelExecution.cancelCell(cell);
    }
    public async cancelAllCells(document: NotebookDocument) {
        this.startCancellation.cancel();
        await this.kernelExecution.cancelAllCells(document);
    }
    public async start(options?: { disableUI?: boolean }): Promise<void> {
        await this.startNotebook(options);
    }
    public async interruptCell(cell: NotebookCell): Promise<InterruptResult> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this.notebook) {
            throw new Error('No notebook to interrupt');
        }
        const result = await this.kernelExecution.interruptCell(cell, this.interruptTimeout);
        if (result === InterruptResult.TimedOut) {
            this._onInterruptTimedOut.fire();
        }
        return result;
    }
    public async interruptAllCells(document: NotebookDocument): Promise<InterruptResult> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this.notebook) {
            throw new Error('No notebook to interrupt');
        }
        const result = await this.kernelExecution.interruptAllCells(document, this.interruptTimeout);
        if (result === InterruptResult.TimedOut) {
            this._onInterruptTimedOut.fire();
        }
        return result;
    }
    public async dispose(): Promise<void> {
        this.restarting = undefined;
        this._notebookPromise = undefined;
        if (this.notebook) {
            await this.notebook.dispose();
            this._disposed = true;
            this._onDisposed.fire();
            this._onStatusChanged.fire(ServerStatus.Dead);
            this.notebook = undefined;
        }
        this.kernelExecution.dispose();
    }
    public async restart(): Promise<void> {
        if (this.restarting) {
            return this.restarting.promise;
        }
        if (this.notebook) {
            this.restarting = createDeferred<void>();
            try {
                await this.notebook.restartKernel(this.launchTimeout);
                await this.initializeAfterStart();
                this.restarting.resolve();
            } catch (ex) {
                this.restarting.reject(ex);
            } finally {
                this.restarting = undefined;
            }
        }
    }
    private async startNotebook(options: { disableUI?: boolean } = {}): Promise<INotebook> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this._notebookPromise) {
            this.startCancellation = new CancellationTokenSource();
            this._notebookPromise = new Promise<INotebook>(async (resolve, reject) => {
                try {
                    await this.validate(this.uri);
                    try {
                        this.notebook = await this.notebookProvider.getOrCreateNotebook({
                            identity: this.uri,
                            resource: this.uri,
                            disableUI: options?.disableUI,
                            getOnly: false,
                            metadata: undefined, // No need to pass this, as we have a kernel connection (metadata is required in lower layers to determine the kernel connection).
                            kernelConnection: this.kernelConnectionMetadata,
                            token: this.startCancellation.token
                        });
                        if (!this.notebook) {
                            // This is an unlikely case.
                            // getOrCreateNotebook would return undefined only if getOnly = true (an issue with typings).
                            throw new Error('Kernel has not been started');
                        }
                    } catch (ex) {
                        traceError('failed to create INotebook in kernel', ex);
                        if (!options.disableUI) {
                            this.errorHandler.handleError(ex).ignoreErrors(); // Just a notification, so don't await this
                        }
                        throw new WrappedError('Kernel has not been started', ex);
                    }
                    await this.initializeAfterStart();
                    resolve(this.notebook);
                } catch (ex) {
                    if (options.disableUI) {
                        sendTelemetryEvent(Telemetry.KernelStartFailedAndUIDisabled);
                    }
                    traceError('failed to start INotebook in kernel', ex);
                    this.startCancellation.cancel();
                    this._notebookPromise = undefined;
                    reject(ex);
                }
            });
        }
        return this._notebookPromise;
    }

    private async validate(uri: Uri): Promise<void> {
        const kernel = this.kernelProvider.get(uri);
        if (!kernel) {
            return;
        }
        const key = uri.toString();
        if (!this.kernelValidated.get(key)) {
            this.isRawNotebookSupported =
                this.isRawNotebookSupported || this.rawNotebookSupported.isSupportedForLocalLaunch();

            const promise = new Promise<void>((resolve) =>
                this.isRawNotebookSupported!.then((isRawNotebookSupported) =>
                    this.kernelSelectionUsage
                        .useSelectedKernel(
                            kernel?.kernelConnectionMetadata,
                            uri,
                            isRawNotebookSupported ? 'raw' : 'jupyter'
                        )
                        .finally(() => {
                            // If still using the same promise, then remove the exception information.
                            // Basically if there's an exception, then we cannot use the kernel and a message would have been displayed.
                            // We don't want to cache such a promise, as its possible the user later installs the dependencies.
                            if (this.kernelValidated.get(key)?.kernel === kernel) {
                                this.kernelValidated.delete(key);
                            }
                        })
                        .finally(resolve)
                        .catch(noop)
                )
            );

            this.kernelValidated.set(key, { kernel, promise });
        }
        await this.kernelValidated.get(key)!.promise;
    }
    private async initializeAfterStart() {
        if (!this.notebook) {
            return;
        }

        // Set the notebook property on the matching editor
        const editor = this.editorProvider.editors.find((item) => this.fs.arePathsSame(item.file, this.uri));
        if (editor) {
            editor.notebook = this.notebook;
        }

        this.disableJedi();
        if (!this.hookedNotebookForEvents.has(this.notebook)) {
            this.hookedNotebookForEvents.add(this.notebook);
            this.notebook.kernelSocket.subscribe(this._kernelSocket);
            this.notebook.onDisposed(() => {
                this._notebookPromise = undefined;
                this._onDisposed.fire();
            });
            this.notebook.onKernelRestarted(() => {
                this._onRestarted.fire();
            });
            this.notebook.onSessionStatusChanged((e) => this._onStatusChanged.fire(e), this, this.disposables);
        }
        if (isPythonKernelConnection(this.kernelConnectionMetadata)) {
            await this.notebook.setLaunchingFile(this.uri.fsPath);
        }
        await this.notebook
            .requestKernelInfo()
            .then((item) => (this._info = item.content))
            .catch(traceWarning.bind('Failed to request KernelInfo'));
        await this.notebook.waitForIdle(this.launchTimeout);
    }

    private disableJedi() {
        if (isPythonKernelConnection(this.kernelConnectionMetadata) && this.notebook) {
            this.notebook.executeObservable(CodeSnippets.disableJedi, this.uri.fsPath, 0, uuid(), true);
        }
    }
}
