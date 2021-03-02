// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type {
    Contents,
    ContentsManager,
    Kernel,
    ServerConnection,
    Session,
    SessionManager
} from '@jupyterlab/services';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken } from 'vscode-jsonrpc';
import { Cancellation } from '../../common/cancellation';
import { traceError, traceInfo } from '../../common/logger';
import { IOutputChannel } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { captureTelemetry } from '../../telemetry';
import { BaseJupyterSession, JupyterSessionStartError } from '../baseJupyterSession';
import { Telemetry } from '../constants';
import { reportAction } from '../progress/decorator';
import { ReportableAction } from '../progress/types';
import { IJupyterConnection, ISessionWithSocket } from '../types';
import { JupyterInvalidKernelError } from './jupyterInvalidKernelError';
import { JupyterWaitForIdleError } from './jupyterWaitForIdleError';
import { JupyterWebSockets } from './jupyterWebSocket';
import { getNameOfKernelConnection } from './kernels/helpers';
import { JupyterKernelService } from './kernels/jupyterKernelService';
import { KernelConnectionMetadata } from './kernels/types';

export class JupyterSession extends BaseJupyterSession {
    constructor(
        private connInfo: IJupyterConnection,
        private serverSettings: ServerConnection.ISettings,
        kernelSpec: KernelConnectionMetadata | undefined,
        private sessionManager: SessionManager,
        private contentsManager: ContentsManager,
        private readonly outputChannel: IOutputChannel,
        private readonly restartSessionCreated: (id: Kernel.IKernelConnection) => void,
        restartSessionUsed: (id: Kernel.IKernelConnection) => void,
        readonly workingDirectory: string,
        private readonly idleTimeout: number,
        private readonly kernelService: JupyterKernelService
    ) {
        super(restartSessionUsed, workingDirectory, idleTimeout);
        this.kernelConnectionMetadata = kernelSpec;
    }

    @reportAction(ReportableAction.JupyterSessionWaitForIdleSession)
    @captureTelemetry(Telemetry.WaitForIdleJupyter, undefined, true)
    public waitForIdle(timeout: number): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout);
    }

    public async connect(timeoutMs: number, cancelToken?: CancellationToken, disableUI?: boolean): Promise<void> {
        if (!this.connInfo) {
            throw new Error(localize.DataScience.sessionDisposed());
        }

        // Start a new session
        this.setSession(
            await this.createNewKernelSession(this.kernelConnectionMetadata, timeoutMs, cancelToken, disableUI)
        );

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

        // Made it this far, we're connected now
        this.connected = true;
    }

    public async createNewKernelSession(
        kernelConnection: KernelConnectionMetadata | undefined,
        timeoutMS: number,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<ISessionWithSocket> {
        let newSession: ISessionWithSocket | undefined;

        try {
            // Don't immediately assume this kernel is valid. Try creating a session with it first.
            if (
                kernelConnection &&
                kernelConnection.kind === 'connectToLiveKernel' &&
                kernelConnection.kernelModel.id
            ) {
                // Remote case.
                newSession = this.sessionManager.connectTo(kernelConnection.kernelModel.session);
                newSession.isRemoteSession = true;
            } else {
                newSession = await this.createSession(this.serverSettings, kernelConnection, cancelToken, disableUI);
                if (!this.connInfo.localLaunch) {
                    newSession.isRemoteSession = true;
                }
            }

            // Make sure it is idle before we return
            await this.waitForIdleOnSession(newSession, timeoutMS);
        } catch (exc) {
            if (exc instanceof JupyterWaitForIdleError) {
                throw exc;
            } else {
                traceError('Failed to change kernel', exc);
                // Throw a new exception indicating we cannot change.
                throw new JupyterInvalidKernelError(kernelConnection);
            }
        }

        return newSession;
    }

    protected async createRestartSession(
        kernelConnection: KernelConnectionMetadata | undefined,
        session: ISessionWithSocket,
        _timeout: number,
        cancelToken?: CancellationToken
    ): Promise<ISessionWithSocket> {
        // We need all of the above to create a restart session
        if (!session || !this.contentsManager || !this.sessionManager) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        let result: ISessionWithSocket | undefined;
        let tryCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let exception: any;
        while (tryCount < 3) {
            try {
                result = await this.createSession(session.serverSettings, kernelConnection, cancelToken, true);
                await this.waitForIdleOnSession(result, this.idleTimeout);
                this.restartSessionCreated(result.kernel);
                return result;
            } catch (exc) {
                traceInfo(`Error waiting for restart session: ${exc}`);
                tryCount += 1;
                if (result) {
                    this.shutdownSession(result, undefined).ignoreErrors();
                }
                result = undefined;
                exception = exc;
            }
        }
        throw exception;
    }

    protected startRestartSession(timeout: number) {
        if (!this.restartSessionPromise && this.session && this.contentsManager) {
            this.restartSessionPromise = this.createRestartSession(
                this.kernelConnectionMetadata,
                this.session,
                timeout
            );
        }
    }

    private async createBackingFile(): Promise<Contents.IModel | undefined> {
        let backingFile: Contents.IModel | undefined = undefined;

        // First make sure the notebook is in the right relative path (jupyter expects a relative path with unix delimiters)
        const relativeDirectory = path.relative(this.connInfo.rootDirectory, this.workingDirectory).replace(/\\/g, '/');

        // However jupyter does not support relative paths outside of the original root.
        const backingFileOptions: Contents.ICreateOptions =
            this.connInfo.localLaunch && !relativeDirectory.startsWith('..')
                ? { type: 'notebook', path: relativeDirectory }
                : { type: 'notebook' };

        try {
            // Create a temporary notebook for this session. Each needs a unique name (otherwise we get the same session every time)
            backingFile = await this.contentsManager.newUntitled(backingFileOptions);
            const backingFileDir = path.dirname(backingFile.path);
            backingFile = await this.contentsManager.rename(
                backingFile.path,
                backingFileDir.length && backingFileDir !== '.'
                    ? `${backingFileDir}/t-${uuid()}.ipynb`
                    : `t-${uuid()}.ipynb` // Note, the docs say the path uses UNIX delimiters.
            );
        } catch (exc) {
            // If it failed for local, try without a relative directory
            if (this.connInfo.localLaunch) {
                try {
                    backingFile = await this.contentsManager.newUntitled({ type: 'notebook' });
                    const backingFileDir = path.dirname(backingFile.path);
                    backingFile = await this.contentsManager.rename(
                        backingFile.path,
                        backingFileDir.length && backingFileDir !== '.'
                            ? `${backingFileDir}/t-${uuid()}.ipynb`
                            : `t-${uuid()}.ipynb` // Note, the docs say the path uses UNIX delimiters.
                    );
                } catch (e) {}
            } else {
                traceError(`Backing file not supported: ${exc}`);
            }
        }

        if (backingFile) {
            return backingFile;
        }
    }

    private async createSession(
        serverSettings: ServerConnection.ISettings,
        kernelConnection: KernelConnectionMetadata | undefined,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<ISessionWithSocket> {
        // Create our backing file for the notebook
        const backingFile = await this.createBackingFile();

        // Make sure the kernel has ipykernel installed if on a local machine.
        if (kernelConnection?.interpreter && this.connInfo.localLaunch) {
            // Make sure the kernel actually exists and is up to date.
            await this.kernelService.ensureKernelIsUsable(kernelConnection, cancelToken, disableUI);
        }

        // Create our session options using this temporary notebook and our connection info
        const options: Session.IOptions = {
            path: backingFile?.path || '.',
            kernelName: getNameOfKernelConnection(kernelConnection) || '',
            name: uuid(), // This is crucial to distinguish this session from any other.
            serverSettings: serverSettings
        };

        return Cancellation.race(
            () =>
                this.sessionManager!.startNew(options)
                    .then(async (session) => {
                        this.logRemoteOutput(
                            localize.DataScience.createdNewKernel().format(this.connInfo.baseUrl, session.kernel.id)
                        );

                        // Add on the kernel sock information
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (session as any).kernelSocketInformation = {
                            socket: JupyterWebSockets.get(session.kernel.id),
                            options: {
                                clientId: session.kernel.clientId,
                                id: session.kernel.id,
                                model: { ...session.kernel.model },
                                userName: session.kernel.username
                            }
                        };

                        return session;
                    })
                    .catch((ex) => Promise.reject(new JupyterSessionStartError(ex)))
                    .finally(() => {
                        if (this.connInfo && backingFile) {
                            this.contentsManager.delete(backingFile.path).ignoreErrors();
                        }
                    }),
            cancelToken
        );
    }

    private logRemoteOutput(output: string) {
        if (this.connInfo && !this.connInfo.localLaunch) {
            this.outputChannel.appendLine(output);
        }
    }
}
