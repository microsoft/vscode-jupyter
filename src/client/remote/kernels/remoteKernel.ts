// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Kernel, KernelMessage, Session, SessionManager } from '@jupyterlab/services';
// import * as path from 'path';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { CancellationToken, CancellationTokenSource, Event, EventEmitter, Uri } from 'vscode';
import { NotebookCell, NotebookDocument } from '../../../../types/vscode-proposed';
import { ServerStatus } from '../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { IAsyncDisposable } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import { DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
// import { CodeSnippets } from '../../datascience/constants';
import { JupyterWaitForIdleError } from '../../datascience/jupyter/jupyterWaitForIdleError';
// import { isPythonKernelConnection } from '../../datascience/jupyter/kernels/helpers';
import { KernelExecution } from '../../datascience/jupyter/kernels/kernelExecution';
import {
    DefaultKernelConnectionMetadata,
    IKernel,
    IKernelProvider,
    IKernelSelectionUsage,
    KernelSpecConnectionMetadata,
    LiveKernelConnectionMetadata
} from '../../datascience/jupyter/kernels/types';
import {
    IDataScienceErrorHandler,
    INotebookEditorProvider,
    InterruptResult,
    KernelSocketInformation
} from '../../datascience/types';
import { IJupyterServerAuthServiceProvider, IJupyterServerConnectionInfo } from '../ui/types';

export class KernelExecutionHelper {
    constructor(private readonly kernel: Kernel.IKernelConnection) {}
    public executeCodeInBackground(code: string) {
        this.kernel.requestExecute(
            {
                code,
                allow_stdin: false,
                silent: true,
                stop_on_error: false,
                store_history: false
            },
            true
        );
    }
    public async waitForIdle(timeout: number) {
        const stopWatch = new StopWatch();
        return new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (this.kernel.status === 'idle') {
                    clearInterval(timer);
                    return resolve();
                }
                if (stopWatch.elapsedTime > timeout) {
                    clearInterval(timer);
                    reject(new JupyterWaitForIdleError(DataScience.jupyterLaunchTimedOut()));
                }
            }, 50);
        });
    }
}

function translateStatus(status?: Kernel.Status) {
    if (!status) {
        return ServerStatus.NotStarted;
    }
    switch (status) {
        case 'unknown':
            return ServerStatus.NotStarted;
        case 'connected':
        case 'idle':
            return ServerStatus.Idle;
        case 'busy':
            return ServerStatus.Busy;
        case 'dead':
            return ServerStatus.Dead;
        case 'reconnecting':
        case 'starting':
            return ServerStatus.Starting;
        case 'restarting':
        case 'autorestarting':
            return ServerStatus.Restarting;
        default: {
            return ServerStatus.NotStarted;
        }
    }
}

export class RemoteJupyterKernel implements IKernel, IAsyncDisposable {
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
        return translateStatus(this._session?.status);
    }
    get disposed(): boolean {
        return this._disposed === true;
    }
    get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket.asObservable();
    }
    private _info?: KernelMessage.IInfoReplyMsg['content'];
    private _disposed?: boolean;
    private readonly _kernelSocket = new Subject<KernelSocketInformation | undefined>();
    private readonly _onStatusChanged = new EventEmitter<ServerStatus>();
    private readonly _onRestarted = new EventEmitter<void>();
    private readonly _onDisposed = new EventEmitter<void>();
    private restarting?: Deferred<void>;
    private readonly kernelExecution: KernelExecution;
    private startCancellation = new CancellationTokenSource();
    private _session?: Session.ISession;
    private readonly connectionInfo: Promise<IJupyterServerConnectionInfo | undefined>;
    constructor(
        public readonly uri: Uri,
        public readonly metadata: Readonly<
            KernelSpecConnectionMetadata | LiveKernelConnectionMetadata | DefaultKernelConnectionMetadata
        >,
        private readonly launchTimeout: number,
        commandManager: ICommandManager,
        errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        kernelProvider: IKernelProvider,
        kernelSelectionUsage: IKernelSelectionUsage,
        appShell: IApplicationShell,
        vscNotebook: IVSCodeNotebook,
        authServiceProvider: IJupyterServerAuthServiceProvider
    ) {
        this.kernelExecution = new KernelExecution(
            kernelProvider,
            commandManager,
            errorHandler,
            editorProvider,
            kernelSelectionUsage,
            appShell,
            vscNotebook,
            metadata
        );
        this.connectionInfo = this.getServerConnectionInfo(uri, authServiceProvider);
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
    public async start(_options?: { disableUI?: boolean; token?: CancellationToken }): Promise<void> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (this._session) {
            return;
        }
        await this.startKernel();
        await this.initializeAfterStart();
    }
    public async interrupt(): Promise<InterruptResult> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this._session) {
            throw new Error('No active session');
        }
        // tslint:disable-next-line: no-suspicious-comment
        // TODO: Support timeouts in interrupts.
        await this._session.kernel.interrupt();
        return InterruptResult.Success;
    }
    public async dispose(): Promise<void> {
        this.restarting = undefined;
        if (this._session) {
            this._session.statusChanged.disconnect(this.statusChangeHandler, this);
            await this._session.shutdown().catch(noop);
            this._disposed = true;
            this._onDisposed.fire();
            this._onStatusChanged.fire(ServerStatus.Dead);
            this._session = undefined;
            this.kernelExecution.kernelConnection = undefined;
        }
        this.kernelExecution.dispose();
        this._onDisposed.dispose();
        this._onRestarted.dispose();
        this._onStatusChanged.dispose();
    }
    public async restart(): Promise<void> {
        if (this.restarting) {
            return this.restarting.promise;
        }
        if (this._session) {
            this.restarting = createDeferred<void>();
            try {
                await this._session.kernel.restart();
                await this.initializeAfterStart();
                this.restarting.resolve();
            } catch (ex) {
                this.restarting.reject(ex);
            } finally {
                this.restarting = undefined;
            }
        }
    }
    private async getServerConnectionInfo(uri: Uri, authServiceProvider: IJupyterServerAuthServiceProvider) {
        const servers = await authServiceProvider.getRemoteConnections();
        return servers.find((item) => item.fileScheme.toLowerCase() === uri.scheme.toLowerCase());
    }
    private async startKernel() {
        const connectionInfo = await this.connectionInfo;
        if (!connectionInfo) {
            throw new Error('No Remote Jupyter Server');
        }
        if (this._session) {
            return;
        }
        const sessionManager = new SessionManager({ serverSettings: connectionInfo.settings });

        if (this.metadata.kind === 'connectToLiveKernel') {
            // Get active sessions & find the corresponding session.
            this._session = sessionManager.connectTo(this.metadata.kernelModel.session);
        } else {
            this._session = await sessionManager.startNew({
                path: this.uri.fsPath.substring(1), // Ignore the leading '/'
                kernelName: this.metadata.kernelSpec?.name // If no kernel spec name, let server pick default.
            });
        }
        this.kernelExecution.kernelConnection = this._session.kernel;
        this._session.statusChanged.connect(this.statusChangeHandler, this);
    }
    private statusChangeHandler(_: Session.ISession, status: Kernel.Status) {
        this._onStatusChanged.fire(translateStatus(status));
    }
    private async initializeAfterStart() {
        if (!this._session) {
            return;
        }
        // this.disableJedi();
        // if (!this.hookedNotebookForEvents.has(this.notebook)) {
        //     this.hookedNotebookForEvents.add(this.notebook);
        //     this.notebook.kernelSocket.subscribe(this._kernelSocket);
        //     this.notebook.onDisposed(() => {
        //         this._notebookPromise = undefined;
        //         this._onDisposed.fire();
        //     });
        //     this.notebook.onKernelRestarted(() => {
        //         this._onRestarted.fire();
        //     });
        //     this.notebook.onSessionStatusChanged((e) => this._onStatusChanged.fire(e), this, this.disposables);
        // }
        // if (isPythonKernelConnection(this.metadata)) {
        //     await this.notebook.setLaunchingFile(this.uri.fsPath);
        // }
        // await this.notebook
        //     .requestKernelInfo()
        //     .then((item) => (this._info = item.content))
        //     .catch(traceWarning.bind('Failed to request KernelInfo'));
        await new KernelExecutionHelper(this._session.kernel).waitForIdle(this.launchTimeout);
        this._kernelSocket.next({
            options: {
                clientId: this._session.kernel.clientId,
                id: this._session.kernel.id,
                model: this._session.kernel.model,
                userName: this._session.kernel.username
            }
        });
    }

    // private disableJedi() {
    //     if (isPythonKernelConnection(this.metadata) && this._session) {
    //         new KernelExecutionHelper(this._session.kernel).executeCodeInBackground(CodeSnippets.disableJedi);
    //     }
    // }
}
