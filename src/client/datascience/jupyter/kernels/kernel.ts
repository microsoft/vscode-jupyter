// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { KernelMessage } from '@jupyterlab/services';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import * as uuid from 'uuid/v4';
import { CancellationTokenSource, Event, EventEmitter, NotebookCell, NotebookDocument, Uri } from 'vscode';
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell } from '../../../common/application/types';
import { traceError, traceInfo, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IDisposableRegistry, IExtensionContext } from '../../../common/types';
import { createDeferred, Deferred } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { CodeSnippets, Telemetry } from '../../constants';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../../telemetry/telemetry';
import { getNotebookMetadata } from '../../notebook/helpers/helpers';
import {
    IDataScienceErrorHandler,
    IJupyterServerUriStorage,
    INotebook,
    INotebookEditorProvider,
    INotebookProvider,
    INotebookProviderConnection,
    InterruptResult,
    KernelSocketInformation
} from '../../types';
import { isPythonKernelConnection } from './helpers';
import { KernelExecution } from './kernelExecution';
import type { IKernel, IKernelProvider, KernelConnectionMetadata } from './types';

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
    private readonly _kernelSocket = new Subject<KernelSocketInformation | undefined>();
    private readonly _onStatusChanged = new EventEmitter<ServerStatus>();
    private readonly _onRestarted = new EventEmitter<void>();
    private readonly _onDisposed = new EventEmitter<void>();
    private _notebookPromise?: Promise<INotebook>;
    private readonly hookedNotebookForEvents = new WeakSet<INotebook>();
    private restarting?: Deferred<void>;
    private readonly kernelExecution: KernelExecution;
    private startCancellation = new CancellationTokenSource();
    constructor(
        public readonly uri: Uri,
        public readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        private readonly notebookProvider: INotebookProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly launchTimeout: number,
        interruptTimeout: number,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        kernelProvider: IKernelProvider,
        appShell: IApplicationShell,
        private readonly fs: IFileSystem,
        context: IExtensionContext,
        private readonly serverStorage: IJupyterServerUriStorage
    ) {
        this.kernelExecution = new KernelExecution(
            kernelProvider,
            errorHandler,
            appShell,
            kernelConnectionMetadata,
            context,
            interruptTimeout,
            disposables
        );
    }
    private perceivedJupyterStartupTelemetryCaptured?: boolean;
    public async executeCell(cell: NotebookCell): Promise<void> {
        const stopWatch = new StopWatch();
        const notebookPromise = this.startNotebook({ disableUI: false, document: cell.notebook });
        const promise = this.kernelExecution.executeCell(notebookPromise, cell);
        this.trackNotebookCellPerceivedColdTime(stopWatch, notebookPromise, promise).catch(noop);
        await promise;
    }
    public async executeAllCells(document: NotebookDocument): Promise<void> {
        const stopWatch = new StopWatch();
        const notebookPromise = this.startNotebook({ disableUI: false, document });
        const promise = this.kernelExecution.executeAllCells(notebookPromise, document);
        this.trackNotebookCellPerceivedColdTime(stopWatch, notebookPromise, promise).catch(noop);
        await promise;
    }
    public async start(options: { disableUI?: boolean; document: NotebookDocument }): Promise<void> {
        await this.startNotebook(options);
    }
    public async interrupt(document: NotebookDocument): Promise<InterruptResult> {
        if (this.restarting) {
            traceInfo(`Interrupt requested & currently restarting ${document.uri}`);
            trackKernelResourceInformation(document.uri, { interruptKernel: true });
            await this.restarting.promise;
        }
        traceInfo(`Interrupt requested ${document.uri}`);
        this.startCancellation.cancel();
        return this.kernelExecution.interrupt(document, this._notebookPromise);
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
    private async trackNotebookCellPerceivedColdTime(
        stopWatch: StopWatch,
        notebookPromise: Promise<INotebook | undefined>,
        executionPromise: Promise<unknown>
    ): Promise<void> {
        if (this.perceivedJupyterStartupTelemetryCaptured) {
            return;
        }
        const notebook = await notebookPromise;
        if (!notebook) {
            return;
        }
        // Setup telemetry
        if (!this.perceivedJupyterStartupTelemetryCaptured) {
            this.perceivedJupyterStartupTelemetryCaptured = true;
            sendTelemetryEvent(Telemetry.PerceivedJupyterStartupNotebook, stopWatch.elapsedTime);
            executionPromise.finally(() =>
                sendTelemetryEvent(Telemetry.StartExecuteNotebookCellPerceivedCold, stopWatch.elapsedTime)
            );
        }
    }
    private async startNotebook(options: { disableUI?: boolean; document: NotebookDocument }): Promise<INotebook> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this._notebookPromise) {
            this.startCancellation = new CancellationTokenSource();
            this._notebookPromise = new Promise<INotebook>(async (resolve, reject) => {
                const stopWatch = new StopWatch();
                try {
                    try {
                        traceInfo(`Starting Notebook in kernel.ts id = ${this.kernelConnectionMetadata.id}`);
                        this.notebook = await this.notebookProvider.getOrCreateNotebook({
                            identity: this.uri,
                            resource: this.uri,
                            disableUI: options?.disableUI,
                            getOnly: false,
                            metadata: getNotebookMetadata(options.document), // No need to pass this, as we have a kernel connection (metadata is required in lower layers to determine the kernel connection).
                            kernelConnection: this.kernelConnectionMetadata,
                            token: this.startCancellation.token
                        });
                        if (!this.notebook) {
                            // This is an unlikely case.
                            // getOrCreateNotebook would return undefined only if getOnly = true (an issue with typings).
                            throw new Error('Kernel has not been started');
                        }
                    } catch (ex) {
                        traceError(`failed to create INotebook in kernel, UI Disabled = ${options.disableUI}`, ex);
                        throw ex;
                    }
                    await this.initializeAfterStart();
                    sendKernelTelemetryEvent(
                        this.uri,
                        Telemetry.PerceivedJupyterStartupNotebook,
                        stopWatch.elapsedTime
                    );
                    if (this.notebook?.connection) {
                        this.updateRemoteUriList(this.notebook.connection).catch(noop);
                    }
                    resolve(this.notebook);
                } catch (ex) {
                    sendKernelTelemetryEvent(
                        options.document.uri,
                        Telemetry.NotebookStart,
                        stopWatch.elapsedTime,
                        undefined,
                        ex
                    );
                    if (options.disableUI) {
                        sendTelemetryEvent(Telemetry.KernelStartFailedAndUIDisabled);
                    } else {
                        this.errorHandler.handleError(ex).ignoreErrors(); // Just a notification, so don't await this
                    }
                    traceError(`failed to start INotebook in kernel, UI Disabled = ${options.disableUI}`, ex);
                    this.startCancellation.cancel();
                    this._notebookPromise = undefined;
                    reject(ex);
                }
            });
        }
        return this._notebookPromise;
    }
    private async updateRemoteUriList(serverConnection: INotebookProviderConnection) {
        if (serverConnection.localLaunch) {
            return;
        }
        // Log this remote URI into our MRU list
        await this.serverStorage.addToUriList(
            serverConnection.url || serverConnection.displayName,
            Date.now(),
            serverConnection.displayName
        );
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
                traceInfo(`Notebook Kernel restarted ${this.notebook?.identity}`);
                this._onRestarted.fire();
            });
            this.notebook.onSessionStatusChanged(
                (e) => {
                    traceInfo(`Notebook Session status ${this.notebook?.identity} # ${e}`);
                    this._onStatusChanged.fire(e);
                },
                this,
                this.disposables
            );
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
