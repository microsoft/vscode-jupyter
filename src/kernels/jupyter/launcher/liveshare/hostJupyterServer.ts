// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode-jsonrpc';
import { inject } from 'inversify';
import { IWorkspaceService } from '../../../../platform/common/application/types';
import { traceInfo, traceError, traceInfoIfCI, traceVerbose } from '../../../../platform/logging';
import {
    IAsyncDisposableRegistry,
    IDisposableRegistry,
    Resource,
    IDisposable,
    IDisplayOptions
} from '../../../../platform/common/types';
import { createDeferred, sleep } from '../../../../platform/common/utils/async';
import { DataScience } from '../../../../platform/common/utils/localize';
import { SessionDisposedError } from '../../../../platform/errors/sessionDisposedError';
import {
    KernelConnectionMetadata,
    isLocalConnection,
    IJupyterConnection,
    KernelActionSource,
    IJupyterKernelConnectionSession
} from '../../../types';
import { JupyterSessionManager } from '../../session/jupyterSessionManager';
import { noop } from '../../../../platform/common/utils/misc';
import { Cancellation } from '../../../../platform/common/cancellation';
import { getDisplayPath } from '../../../../platform/common/platform/fs-paths';
import { INotebookServer } from '../../types';
import { Uri } from 'vscode';
import { RemoteJupyterServerConnectionError } from '../../../../platform/errors/remoteJupyterServerConnectionError';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Represents a connection to a Jupyter server.
 */
export class HostJupyterServer implements INotebookServer {
    private connectionInfoDisconnectHandler: IDisposable | undefined;
    private serverExitCode: number | undefined;
    private sessions = new Set<Promise<IJupyterKernelConnectionSession>>();
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        public connection: IJupyterConnection,
        private sessionManager: JupyterSessionManager
    ) {
        this.asyncRegistry.push(this);

        this.connectionInfoDisconnectHandler = this.connection.disconnected((c) => {
            try {
                this.serverExitCode = c;
                traceError(DataScience.jupyterServerCrashed(c));
                this.shutdown().catch(noop);
            } catch {
                noop();
            }
        });
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            traceVerbose(`Disposing HostJupyterServer`);
            await this.shutdown();
            traceVerbose(`Finished disposing HostJupyterServer`);
        }
    }

    private get isDisposed() {
        return this.disposed;
    }
    private throwIfDisposedOrCancelled(token?: CancellationToken) {
        if (this.isDisposed) {
            throw new SessionDisposedError();
        }
        Cancellation.throwIfCanceled(token);
    }
    private async createNotebookInstance(
        resource: Resource,
        sessionManager: JupyterSessionManager,
        kernelConnection: KernelConnectionMetadata,
        cancelToken: CancellationToken,
        ui: IDisplayOptions,
        actionSource: KernelActionSource
    ): Promise<IJupyterKernelConnectionSession> {
        this.throwIfDisposedOrCancelled(cancelToken);
        // Compute launch information from the resource and the notebook metadata
        const sessionPromise = createDeferred<IJupyterKernelConnectionSession>();
        // Save the Session
        this.trackDisposable(sessionPromise.promise);
        const startNewSession = async () => {
            this.throwIfDisposedOrCancelled(cancelToken);
            // Figure out the working directory we need for our new notebook. This is only necessary for local.
            const workingDirectory = isLocalConnection(kernelConnection)
                ? await this.workspaceService.computeWorkingDirectory(resource)
                : '';
            this.throwIfDisposedOrCancelled(cancelToken);
            // Start a session (or use the existing one if allowed)
            const session = await sessionManager.startNew(
                resource,
                kernelConnection,
                Uri.file(workingDirectory),
                ui,
                cancelToken,
                actionSource
            );
            this.throwIfDisposedOrCancelled(cancelToken);
            traceInfo(`Started session for kernel ${kernelConnection.kind}:${kernelConnection.id}`);
            return session;
        };

        try {
            const session = await startNewSession();
            this.throwIfDisposedOrCancelled(cancelToken);

            if (session) {
                sessionPromise.resolve(session);
            } else {
                sessionPromise.reject(this.getDisposedError());
            }
        } catch (ex) {
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            sessionPromise.reject(ex);
        }

        return sessionPromise.promise;
    }

    public async createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        cancelToken: CancellationToken,
        ui: IDisplayOptions,
        creator: KernelActionSource
    ): Promise<IJupyterKernelConnectionSession> {
        this.throwIfDisposedOrCancelled(cancelToken);
        traceInfoIfCI(
            `HostJupyterServer.createNotebook for ${getDisplayPath(resource)} with ui.disableUI=${
                ui.disableUI
            }, cancelToken.isCancellationRequested=${cancelToken.isCancellationRequested}`
        );
        if (!this.sessionManager || this.isDisposed) {
            throw new SessionDisposedError();
        }
        if (
            this.sessionManager &&
            !this.isDisposed &&
            (kernelConnection.kind === 'connectToLiveRemoteKernel' ||
                kernelConnection.kind === 'startUsingRemoteKernelSpec')
        ) {
            try {
                await Promise.all([this.sessionManager.getRunningKernels(), this.sessionManager.getKernelSpecs()]);
            } catch (ex) {
                traceError(
                    'Failed to fetch running kernels from remote server, connection may be outdated or remote server may be unreachable',
                    ex
                );
                throw new RemoteJupyterServerConnectionError(kernelConnection.baseUrl, kernelConnection.serverId, ex);
            }
        }
        // Create a session and return it.
        const session = await this.createNotebookInstance(
            resource,
            this.sessionManager,
            kernelConnection,
            cancelToken,
            ui,
            creator
        );
        this.throwIfDisposedOrCancelled(cancelToken);
        const baseUrl = this.connection?.baseUrl || '';
        traceVerbose(DataScience.createdNewNotebook(baseUrl));
        return session;
    }

    private async shutdown(): Promise<void> {
        try {
            // Order should be
            // 1) connectionInfoDisconnectHandler - listens to process close
            // 2) sessions (owned by the notebooks)
            // 3) session manager (owned by this object)
            // 4) connInfo (owned by this object) - kills the jupyter process

            if (this.connectionInfoDisconnectHandler) {
                this.connectionInfoDisconnectHandler.dispose();
                this.connectionInfoDisconnectHandler = undefined;
            }

            traceVerbose('Shutting down notebooks');
            const session = await Promise.all([...this.sessions.values()]);
            await Promise.all(session.map((session) => session.dispose()));
            traceVerbose(`Shut down session manager : ${this.sessionManager ? 'existing' : 'undefined'}`);
            if (this.sessionManager) {
                // Session manager in remote case may take too long to shutdown. Don't wait that
                // long.
                const result = await Promise.race([sleep(10_000), this.sessionManager.dispose()]);
                if (result === 10_000) {
                    traceError(`Session shutdown timed out.`);
                }
            }

            // After shutting down notebooks and session manager, kill the main process.
            if (this.connection && this.connection) {
                traceVerbose('Shutdown server - dispose conn info');
                this.connection.dispose(); // This should kill the process that's running
            }
        } catch (e) {
            traceError(`Error during shutdown: `, e);
        }
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IJupyterConnection {
        if (!this.connection) {
            throw new Error('Not connected');
        }

        // Return a copy with a no-op for dispose
        return {
            ...this.connection,
            dispose: noop
        };
    }

    public getDisposedError(): Error {
        // We may have been disposed because of a crash. See if our connection info is indicating shutdown
        if (this.serverExitCode) {
            return new Error(DataScience.jupyterServerCrashed(this.serverExitCode));
        }

        // Default is just say session was disposed
        return new SessionDisposedError();
    }
    private trackDisposable(sessionPromise: Promise<IJupyterKernelConnectionSession>) {
        sessionPromise
            .then((session) => {
                session.onDidDispose(() => this.sessions.delete(sessionPromise), this, this.disposables);
            })
            .catch(() => this.sessions.delete(sessionPromise));

        // Save the notebook
        this.sessions.add(sessionPromise);
    }
}
