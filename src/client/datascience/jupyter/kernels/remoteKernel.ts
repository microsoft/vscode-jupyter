// // Copyright (c) Microsoft Corporation. All rights reserved.
// // Licensed under the MIT License.

// import { Kernel, Session } from '@jupyterlab/services';
// // import * as path from 'path';
// import { CancellationToken, EventEmitter, Uri } from 'vscode';
// import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
// import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
// import { IDisposableRegistry } from '../../../common/types';
// import { DataScience } from '../../../common/utils/localize';
// import { noop } from '../../../common/utils/misc';
// import { StopWatch } from '../../../common/utils/stopWatch';
// import { JupyterServerConnectionService } from '../../../remote/connection/remoteConnectionsService';
// import { IJupyterServerConnectionInfo, IJupyterServerConnectionService } from '../../../remote/ui/types';
// import {
//     IDataScienceErrorHandler,
//     IJupyterConnection,
//     IJupyterSessionManager,
//     IJupyterSessionManagerFactory,
//     INotebookEditorProvider,
//     InterruptResult,
//     IRawNotebookSupportedService
// } from '../../types';
// import { JupyterWaitForIdleError } from '../jupyterWaitForIdleError';
// import { BaseKernel } from './baseKernel';
// import {
//     DefaultKernelConnectionMetadata,
//     IKernelProvider,
//     IKernelSelectionUsage,
//     KernelSpecConnectionMetadata,
//     LiveKernelConnectionMetadata
// } from './types';

// export class KernelExecutionHelper {
//     constructor(private readonly kernel: Kernel.IKernelConnection) {}
//     public executeCodeInBackground(code: string) {
//         this.kernel.requestExecute(
//             {
//                 code,
//                 allow_stdin: false,
//                 silent: true,
//                 stop_on_error: false,
//                 store_history: false
//             },
//             true
//         );
//     }
//     public async waitForIdle(timeout: number) {
//         const stopWatch = new StopWatch();
//         return new Promise((resolve, reject) => {
//             const timer = setInterval(() => {
//                 if (this.kernel.status === 'idle') {
//                     clearInterval(timer);
//                     return resolve();
//                 }
//                 if (stopWatch.elapsedTime > timeout) {
//                     clearInterval(timer);
//                     reject(new JupyterWaitForIdleError(DataScience.jupyterLaunchTimedOut()));
//                 }
//             }, 50);
//         });
//     }
// }

// function translateStatus(status?: Kernel.Status) {
//     if (!status) {
//         return ServerStatus.NotStarted;
//     }
//     switch (status) {
//         case 'unknown':
//             return ServerStatus.NotStarted;
//         case 'connected':
//         case 'idle':
//             return ServerStatus.Idle;
//         case 'busy':
//             return ServerStatus.Busy;
//         case 'dead':
//             return ServerStatus.Dead;
//         case 'reconnecting':
//         case 'starting':
//             return ServerStatus.Starting;
//         case 'restarting':
//         case 'autorestarting':
//             return ServerStatus.Restarting;
//         default: {
//             return ServerStatus.NotStarted;
//         }
//     }
// }

// export class RemoteJupyterKernel extends BaseKernel {
//     private _disposed?: boolean;
//     private sessionManager?: IJupyterSessionManager;
//     private readonly connectionInfo: Promise<IJupyterConnection | undefined>;
//     constructor(
//         uri: Uri,
//         metadata: Readonly<
//             KernelSpecConnectionMetadata | LiveKernelConnectionMetadata | DefaultKernelConnectionMetadata
//         >,
//         disposables: IDisposableRegistry,
//         launchTimeout: number,
//         commandManager: ICommandManager,
//         errorHandler: IDataScienceErrorHandler,
//         editorProvider: INotebookEditorProvider,
//         kernelProvider: IKernelProvider,
//         kernelSelectionUsage: IKernelSelectionUsage,
//         appShell: IApplicationShell,
//         vscNotebook: IVSCodeNotebook,
//         authServiceProvider: JupyterServerConnectionService,
//         private readonly sessionFactory: IJupyterSessionManagerFactory,
//         rawNotebookSupported: IRawNotebookSupportedService
//     ) {
//         super(
//             uri,
//             metadata,
//             disposables,
//             launchTimeout,
//             commandManager,
//             errorHandler,
//             editorProvider,
//             kernelProvider,
//             kernelSelectionUsage,
//             appShell,
//             vscNotebook,
//             rawNotebookSupported
//         );
//         this.connectionInfo = authServiceProvider.findConnection(uri)?.connection;
//     }
//     public async dispose(): Promise<void> {
//         this._disposed = true;
//         this.restarting = undefined;
//         if (this.jupyterSession?.session) {
//             this.jupyterSession.session.statusChanged.disconnect(this.statusChangeHandler, this);
//         }
//         this._onDisposed.dispose();
//         this._onRestarted.dispose();
//         this._onStatusChanged.dispose();
//     }
//     protected async onRestart(): Promise<void> {
//         if (this.jupyterSession?.session) {
//             await this.jupyterSession.restart(this.launchTimeout);
//             await this.initializeAfterStart();
//             this._onRestarted.fire();
//         }
//     }
//     protected async onInterrupt(): Promise<InterruptResult> {
//         // tslint:disable-next-line: no-suspicious-comment
// tslint:disable-next-line: no-suspicious-comment
//         // TODO: Support timeouts in interrupts.
//         await this.jupyterSession?.interrupt(this.launchTimeout);
//         return InterruptResult.Success;
//     }
//     protected async onStart(_options?: { disableUI?: boolean; token?: CancellationToken }): Promise<void> {
//         await this.startKernel();
//         await this.initializeAfterStart();
//     }
//     protected isDisposed(): boolean {
//         return this._disposed === true;
//     }
//     private async getServerConnectionInfo(uri: Uri, authServiceProvider: IJupyterConnectionsService) {
//         const servers = await authServiceProvider.getRemoteConnections();
//         return servers.find((item) => item.fileScheme.toLowerCase() === uri.scheme.toLowerCase());
//     }
//     private async startKernel() {
//         const connectionInfo = await this.connectionInfo;
//         if (!connectionInfo) {
//             throw new Error('No Remote Jupyter Server');
//         }
//         const connection: IJupyterConnection = {
//             id: '',
//             baseUrl: connectionInfo.settings.baseUrl,
//             disconnected: new EventEmitter<number>().event,
//             displayName: '',
//             dispose: noop,
//             hostName: '',
//             localLaunch: false,
//             localProcExitCode: undefined,
//             rootDirectory: this.uri.fsPath,
//             token: connectionInfo.settings.token,
//             type: 'jupyter',
//             valid: true,
//             getAuthHeader: () => new connectionInfo.settings.Headers()
//         };
//         this.sessionManager = this.sessionManager || (await this.sessionFactory.create(connection, true));
//         this.jupyterSession = await this.sessionManager.startNew(this.metadata, this.uri.fsPath);
//         if (!this.jupyterSession) {
//             throw new Error('No new session');
//         }
//         this.kernelExecution.session = this.jupyterSession;
//         this.jupyterSession.session!.statusChanged.connect(this.statusChangeHandler, this);
//     }
//     private statusChangeHandler(_: Session.ISession, status: Kernel.Status) {
//         this._onStatusChanged.fire(translateStatus(status));
//     }
//     private async initializeAfterStart() {
//         if (!this.jupyterSession?.session) {
//             return;
//         }
//         const kernel = this.jupyterSession.session.kernel;
//         await new KernelExecutionHelper(kernel).waitForIdle(this.launchTimeout);
//         this._kernelSocket.next({
//             options: {
//                 clientId: kernel.clientId,
//                 id: kernel.id,
//                 model: kernel.model,
//                 userName: kernel.username
//             }
//         });
//     }
// }
