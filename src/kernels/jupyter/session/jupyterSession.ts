// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Contents, ContentsManager, KernelSpecManager, Session, SessionManager } from '@jupyterlab/services';
import uuid from 'uuid/v4';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';
import { Cancellation } from '../../../platform/common/cancellation';
import { BaseError } from '../../../platform/errors/types';
import { traceVerbose, traceError, traceWarning } from '../../../platform/logging';
import { Resource, IOutputChannel, IDisplayOptions } from '../../../platform/common/types';
import { waitForCondition } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterInvalidKernelError } from '../../errors/jupyterInvalidKernelError';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { BaseJupyterSession, JupyterSessionStartError } from '../../common/baseJupyterSession';
import { getNameOfKernelConnection, isPythonKernelConnection } from '../../helpers';
import {
    KernelConnectionMetadata,
    isLocalConnection,
    IJupyterConnection,
    ISessionWithSocket,
    KernelActionSource,
    IJupyterKernelConnectionSession,
    isRemoteConnection
} from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IBackupFile, IJupyterBackingFileCreator, IJupyterKernelService, IJupyterRequestCreator } from '../types';
import { CancellationError, Uri, workspace } from 'vscode';
import { generateBackingIPyNbFileName } from './backingFileCreator.base';
import { noop } from '../../../platform/common/utils/misc';

// function is
export class JupyterSession extends BaseJupyterSession implements IJupyterKernelConnectionSession {
    public readonly kind: 'remoteJupyter' | 'localJupyter';

    constructor(
        resource: Resource,
        private connInfo: IJupyterConnection,
        kernelConnectionMetadata: KernelConnectionMetadata,
        private specsManager: KernelSpecManager,
        private sessionManager: SessionManager,
        private contentsManager: ContentsManager,
        private readonly outputChannel: IOutputChannel,
        override readonly workingDirectory: Uri,
        private readonly idleTimeout: number,
        private readonly kernelService: IJupyterKernelService | undefined,
        interruptTimeout: number,
        private readonly backingFileCreator: IJupyterBackingFileCreator,
        private readonly requestCreator: IJupyterRequestCreator,
        private readonly sessionCreator: KernelActionSource
    ) {
        super(resource, kernelConnectionMetadata, workingDirectory, interruptTimeout);
        this.kind = connInfo.localLaunch ? 'localJupyter' : 'remoteJupyter';
    }

    public override isServerSession(): this is IJupyterKernelConnectionSession {
        return true;
    }

    @capturePerfTelemetry(Telemetry.WaitForIdleJupyter)
    public waitForIdle(timeout: number, token: CancellationToken): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout, token);
    }
    public async connect(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<void> {
        // Start a new session
        this.setSession(await this.createNewKernelSession(options));

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

        // Made it this far, we're connected now
        this.connected = true;
    }

    public async createNewKernelSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<ISessionWithSocket> {
        let newSession: ISessionWithSocket | undefined;
        try {
            // Don't immediately assume this kernel is valid. Try creating a session with it first.
            if (
                this.kernelConnectionMetadata &&
                this.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel' &&
                this.kernelConnectionMetadata.kernelModel.id &&
                this.kernelConnectionMetadata.kernelModel.model
            ) {
                // Remote case.
                newSession = this.sessionManager.connectTo({
                    ...this.kernelConnectionMetadata.kernelModel,
                    model: this.kernelConnectionMetadata.kernelModel.model
                }) as ISessionWithSocket;
                newSession.kernelConnectionMetadata = this.kernelConnectionMetadata;
                newSession.kernelSocketInformation = {
                    socket: this.requestCreator.getWebsocket(this.kernelConnectionMetadata.id),
                    options: {
                        clientId: '',
                        id: this.kernelConnectionMetadata.id,
                        model: { ...this.kernelConnectionMetadata.kernelModel.model },
                        userName: ''
                    }
                };
                newSession.isRemoteSession = true;
                newSession.resource = this.resource;

                // newSession.kernel?.connectionStatus
                await waitForCondition(
                    async () =>
                        newSession?.kernel?.connectionStatus === 'connected' || options.token.isCancellationRequested,
                    this.idleTimeout,
                    100
                );
                if (options.token.isCancellationRequested) {
                    throw new CancellationError();
                }
            } else {
                traceVerbose(`createNewKernelSession ${this.kernelConnectionMetadata?.id}`);
                newSession = await this.createSession(options);
                newSession.resource = this.resource;

                // Make sure it is idle before we return
                await this.waitForIdleOnSession(newSession, this.idleTimeout, options.token);
            }
        } catch (exc) {
            // Don't log errors if UI is disabled (e.g. auto starting a kernel)
            // Else we just pollute the logs with lots of noise.
            const loggerFn = options.ui.disableUI ? traceVerbose : traceError;
            // Don't swallow known exceptions.
            if (exc instanceof BaseError) {
                loggerFn('Failed to change kernel, re-throwing', exc);
                throw exc;
            } else {
                loggerFn('Failed to change kernel', exc);
                // Throw a new exception indicating we cannot change.
                throw new JupyterInvalidKernelError(this.kernelConnectionMetadata);
            }
        }

        return newSession;
    }
    protected async createRestartSession(
        disableUI: boolean,
        session: ISessionWithSocket,
        cancelToken: CancellationToken
    ): Promise<ISessionWithSocket> {
        // We need all of the above to create a restart session
        if (!session || !this.contentsManager || !this.sessionManager) {
            throw new SessionDisposedError();
        }
        let result: ISessionWithSocket | undefined;
        let tryCount = 0;
        const ui = new DisplayOptions(disableUI);
        try {
            traceVerbose(
                `JupyterSession.createNewKernelSession ${tryCount}, id is ${this.kernelConnectionMetadata?.id}`
            );
            result = await this.createSession({ token: cancelToken, ui });
            await this.waitForIdleOnSession(result, this.idleTimeout, cancelToken);
            return result;
        } catch (exc) {
            traceWarning(`Error waiting for restart session: ${exc}`);
            if (result) {
                this.shutdownSession(result, undefined, true).ignoreErrors();
            }
            result = undefined;
            throw exc;
        } finally {
            ui.dispose();
        }
    }

    protected startRestartSession(disableUI: boolean) {
        if (!this.session) {
            throw new Error('Session disposed or not initialized');
        }
        const token = new CancellationTokenSource();
        const promise = this.createRestartSession(disableUI, this.session, token.token);
        this.restartSessionPromise = { token, promise };
        promise
            .finally(() => {
                token.dispose();
                if (this.restartSessionPromise?.promise === promise) {
                    this.restartSessionPromise = undefined;
                }
            })
            .catch(noop);
        return promise;
    }

    async invokeWithFileSynced(contents: string, handler: (file: IBackupFile) => Promise<void>): Promise<void> {
        if (!this.resource) {
            return;
        }

        const backingFile = await this.backingFileCreator.createBackingFile(
            this.resource,
            this.workingDirectory,
            this.kernelConnectionMetadata,
            this.connInfo,
            this.contentsManager
        );

        if (!backingFile) {
            return;
        }

        await this.contentsManager
            .save(backingFile!.filePath, {
                content: JSON.parse(contents),
                type: 'notebook'
            })
            .ignoreErrors();

        await handler({
            filePath: backingFile.filePath,
            dispose: backingFile.dispose.bind(backingFile)
        });

        await backingFile.dispose();
        await this.contentsManager.delete(backingFile.filePath).ignoreErrors();
    }

    async createTempfile(ext: string): Promise<string> {
        const tempFile = await this.contentsManager.newUntitled({ type: 'file', ext });
        return tempFile.path;
    }

    async deleteTempfile(file: string): Promise<void> {
        await this.contentsManager.delete(file);
    }

    async getContents(file: string, format: Contents.FileFormat): Promise<Contents.IModel> {
        const data = await this.contentsManager.get(file, { type: 'file', format: format, content: true });
        return data;
    }

    private async createSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<ISessionWithSocket> {
        let backingFile: IBackupFile | undefined;
        let remoteFilePath: string | undefined;

        if (isRemoteConnection(this.kernelConnectionMetadata) && this.connInfo.workingDirectory && this.resource) {
            const currentWorkingDirectory = workspace.getWorkspaceFolder(Uri.from(this.resource));
            if (currentWorkingDirectory) {
                remoteFilePath = this.resource.path.replace(
                    currentWorkingDirectory.uri.path,
                    this.connInfo.workingDirectory
                );
            }
        }
        if (!remoteFilePath) {
            // Create our backing file for the notebook
            backingFile = await this.backingFileCreator.createBackingFile(
                this.resource,
                this.workingDirectory,
                this.kernelConnectionMetadata,
                this.connInfo,
                this.contentsManager
            );
            remoteFilePath = backingFile?.filePath;
        }

        // Make sure the kernel has ipykernel installed if on a local machine.
        if (
            this.kernelConnectionMetadata?.interpreter &&
            isLocalConnection(this.kernelConnectionMetadata) &&
            this.kernelService
        ) {
            // Make sure the kernel actually exists and is up to date.
            try {
                await this.kernelService.ensureKernelIsUsable(
                    this.resource,
                    this.kernelConnectionMetadata,
                    options.ui,
                    options.token,
                    this.sessionCreator === '3rdPartyExtension'
                );
            } catch (ex) {
                // If we failed to create the kernel, we need to clean up the file.
                if (this.connInfo && backingFile) {
                    this.contentsManager.delete(backingFile.filePath).ignoreErrors();
                }
                throw ex;
            }
        }

        // If kernelName is empty this can cause problems for servers that don't
        // understand that empty kernel name means the default kernel.
        // See https://github.com/microsoft/vscode-jupyter/issues/5290
        const kernelName =
            getNameOfKernelConnection(this.kernelConnectionMetadata) ?? this.specsManager?.specs?.default ?? '';

        // Create our session options using this temporary notebook and our connection info
        const sessionOptions: Session.ISessionOptions = {
            path: remoteFilePath ?? generateBackingIPyNbFileName(this.resource), // Name has to be unique
            kernel: {
                name: kernelName
            },
            name: uuid(), // This is crucial to distinguish this session from any other.
            type: 'notebook'
        };

        const requestCreator = this.requestCreator;

        return Cancellation.race(
            () =>
                this.sessionManager!.startNew(sessionOptions, {
                    kernelConnectionOptions: {
                        handleComms: true // This has to be true for ipywidgets to work
                    }
                })
                    .then(async (session) => {
                        if (session.kernel) {
                            this.logRemoteOutput(
                                DataScience.createdNewKernel(this.connInfo.baseUrl, session?.kernel?.id || '')
                            );
                            const sessionWithSocket = session as ISessionWithSocket;

                            // Add on the kernel metadata & sock information
                            sessionWithSocket.resource = this.resource;
                            sessionWithSocket.kernelConnectionMetadata = this.kernelConnectionMetadata;
                            sessionWithSocket.kernelSocketInformation = {
                                get socket() {
                                    // When we restart kernels, a new websocket is created and we need to get the new one.
                                    // & the id in the dictionary is the kernel.id.
                                    return requestCreator.getWebsocket(session.kernel!.id);
                                },
                                options: {
                                    clientId: session.kernel.clientId,
                                    id: session.kernel.id,
                                    model: { ...session.kernel.model },
                                    userName: session.kernel.username
                                }
                            };
                            if (!isLocalConnection(this.kernelConnectionMetadata)) {
                                sessionWithSocket.isRemoteSession = true;
                            }
                            return sessionWithSocket;
                        }
                        throw new JupyterSessionStartError(new Error(`No kernel created`));
                    })
                    .catch((ex) => Promise.reject(new JupyterSessionStartError(ex)))
                    .finally(async () => {
                        if (this.connInfo && backingFile) {
                            this.contentsManager.delete(backingFile.filePath).ignoreErrors();
                        }
                    }),
            options.token
        );
    }

    private logRemoteOutput(output: string) {
        if (!isLocalConnection(this.kernelConnectionMetadata)) {
            this.outputChannel.appendLine(output);
        }
    }
}
