// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../../platform/common/extensions';

import { CancellationToken } from 'vscode-jsonrpc';
import { inject, named } from 'inversify';
import { IWorkspaceService } from '../../../../platform/common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../../../platform/common/constants';
import { traceInfo, traceError, traceInfoIfCI } from '../../../../platform/logging';
import {
    IAsyncDisposableRegistry,
    IOutputChannel,
    IDisposableRegistry,
    Resource,
    IDisposable,
    IDisplayOptions
} from '../../../../platform/common/types';
import { createDeferred, sleep } from '../../../../platform/common/utils/async';
import { DataScience } from '../../../../platform/common/utils/localize';
import { StopWatch } from '../../../../platform/common/utils/stopWatch';
import { SessionDisposedError } from '../../../../platform/errors/sessionDisposedError';
import { sendKernelTelemetryEvent } from '../../../../telemetry/telemetry';
import { Telemetry } from '../../../../webviews/webview-side/common/constants';
import {
    KernelConnectionMetadata,
    isLocalConnection,
    IJupyterConnection,
    INotebook,
    KernelActionSource
} from '../../../types';
import { JupyterSessionManager } from '../../session/jupyterSessionManager';
import { JupyterNotebook } from '../jupyterNotebook';
import { noop } from '../../../../platform/common/utils/misc';
import { Cancellation } from '../../../../platform/common/cancellation';
import { getDisplayPath } from '../../../../platform/common/platform/fs-paths';
import { INotebookServer } from '../../types';
import { Uri } from 'vscode';
/* eslint-disable @typescript-eslint/no-explicit-any */

export class HostJupyterServer implements INotebookServer {
    private connectionInfoDisconnectHandler: IDisposable | undefined;
    private serverExitCode: number | undefined;
    private notebooks = new Set<Promise<INotebook>>();
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly jupyterOutputChannel: IOutputChannel,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        public connection: IJupyterConnection,
        private sessionManager: JupyterSessionManager
    ) {
        this.asyncRegistry.push(this);

        this.connectionInfoDisconnectHandler = this.connection.disconnected((c) => {
            try {
                this.serverExitCode = c;
                traceError(DataScience.jupyterServerCrashed().format(c.toString()));
                this.shutdown().ignoreErrors();
            } catch {
                noop();
            }
        });
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            traceInfo(`Disposing HostJupyterServer`);
            await this.shutdown();
            traceInfo(`Finished disposing HostJupyterServer`);
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
    ): Promise<INotebook> {
        this.throwIfDisposedOrCancelled(cancelToken);
        // Compute launch information from the resource and the notebook metadata
        const notebookPromise = createDeferred<INotebook>();
        // Save the notebook
        this.trackDisposable(notebookPromise.promise);
        const getExistingSession = async () => {
            const connection = this.connection;
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
            traceInfo(`Started session for kernel ${kernelConnection.id}`);
            return { connection, session };
        };

        try {
            const { connection, session } = await getExistingSession();
            this.throwIfDisposedOrCancelled(cancelToken);

            if (session) {
                // Create our notebook
                const notebook = new JupyterNotebook(session, connection);
                traceInfo(`Finished connecting kernel ${kernelConnection.id}`);
                notebookPromise.resolve(notebook);
            } else {
                notebookPromise.reject(this.getDisposedError());
            }
        } catch (ex) {
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            notebookPromise.reject(ex);
        }

        return notebookPromise.promise;
    }

    public async createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        cancelToken: CancellationToken,
        ui: IDisplayOptions,
        creator: KernelActionSource
    ): Promise<INotebook> {
        this.throwIfDisposedOrCancelled(cancelToken);
        traceInfoIfCI(
            `HostJupyterServer.createNotebook for ${getDisplayPath(resource)} with ui.disableUI=${
                ui.disableUI
            }, cancelToken.isCancellationRequested=${cancelToken.isCancellationRequested}`
        );
        if (!this.sessionManager || this.isDisposed) {
            throw new SessionDisposedError();
        }
        const stopWatch = new StopWatch();
        // Create a notebook and return it.
        try {
            const notebook = await this.createNotebookInstance(
                resource,
                this.sessionManager,
                kernelConnection,
                cancelToken,
                ui,
                creator
            );
            this.throwIfDisposedOrCancelled(cancelToken);
            const baseUrl = this.connection?.baseUrl || '';
            this.logRemoteOutput(DataScience.createdNewNotebook().format(baseUrl));
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime);
            return notebook;
        } catch (ex) {
            sendKernelTelemetryEvent(
                resource,
                Telemetry.JupyterCreatingNotebook,
                stopWatch.elapsedTime,
                undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ex as any
            );
            throw ex;
        }
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

            traceInfo('Shutting down notebooks');
            const notebooks = await Promise.all([...this.notebooks.values()]);
            await Promise.all(notebooks.map((n) => n?.session.dispose()));
            traceInfo(`Shut down session manager : ${this.sessionManager ? 'existing' : 'undefined'}`);
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
                traceInfo('Shutdown server - dispose conn info');
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
            return new Error(DataScience.jupyterServerCrashed().format(this.serverExitCode.toString()));
        }

        // Default is just say session was disposed
        return new SessionDisposedError();
    }
    private trackDisposable(notebook: Promise<INotebook>) {
        notebook
            .then((nb) => {
                nb.session.onDidDispose(() => this.notebooks.delete(notebook), this, this.disposables);
            })
            .catch(() => this.notebooks.delete(notebook));

        // Save the notebook
        this.notebooks.add(notebook);
    }

    private logRemoteOutput(output: string) {
        if (!this.connection?.localLaunch) {
            this.jupyterOutputChannel.appendLine(output);
        }
    }
}
