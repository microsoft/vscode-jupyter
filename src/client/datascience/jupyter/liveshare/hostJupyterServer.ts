// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { CancellationToken } from 'vscode-jsonrpc';
import { IWorkspaceService } from '../../../common/application/types';
import { traceError, traceInfo } from '../../../common/logger';
import {
    IAsyncDisposableRegistry,
    IDisposable,
    IDisposableRegistry,
    IOutputChannel,
    Resource
} from '../../../common/types';
import { createDeferred, Deferred, sleep } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import {
    IDisplayOptions,
    IJupyterConnection,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookServer
} from '../../types';
import { computeWorkingDirectory } from '../jupyterUtils';
import { isLocalConnection, KernelConnectionMetadata } from '../kernels/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../../common/constants';
import { inject, injectable, named } from 'inversify';
import { JupyterNotebook } from '../jupyterNotebook';
import { noop } from '../../../common/utils/misc';
import { Telemetry } from '../../constants';
import { sendKernelTelemetryEvent } from '../../telemetry/telemetry';
import { StopWatch } from '../../../common/utils/stopWatch';
import { JupyterSessionManager } from '../jupyterSessionManager';
import { SessionDisposedError } from '../../errors/sessionDisposedError';
import { CancellationTokenSource } from 'vscode';
/* eslint-disable @typescript-eslint/no-explicit-any */

@injectable()
export class HostJupyterServer implements INotebookServer {
    private connection: IJupyterConnection | undefined;
    private connectPromise: Deferred<IJupyterConnection> = createDeferred<IJupyterConnection>();
    private connectionInfoDisconnectHandler: IDisposable | undefined;
    private serverExitCode: number | undefined;
    private notebooks = new Set<Promise<INotebook>>();
    private sessionManager: JupyterSessionManager | undefined;
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IJupyterSessionManagerFactory) private readonly sessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly jupyterOutputChannel: IOutputChannel,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        this.asyncRegistry.push(this);
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

    private async createNotebookInstance(
        resource: Resource,
        sessionManager: JupyterSessionManager,
        kernelConnection: KernelConnectionMetadata,
        cancelTokenSource: CancellationTokenSource,
        ui: IDisplayOptions
    ): Promise<INotebook> {
        // Compute launch information from the resource and the notebook metadata
        const notebookPromise = createDeferred<INotebook>();
        // Save the notebook
        this.trackDisposable(notebookPromise.promise);
        const getExistingSession = async () => {
            const connection = await this.computeLaunchInfo();

            // Figure out the working directory we need for our new notebook. This is only necessary for local.
            const workingDirectory = isLocalConnection(kernelConnection)
                ? await computeWorkingDirectory(resource, this.workspaceService)
                : '';
            // Start a session (or use the existing one if allowed)
            const session = await sessionManager.startNew(
                resource,
                kernelConnection,
                workingDirectory,
                ui,
                cancelTokenSource
            );
            traceInfo(`Started session for kernel ${kernelConnection.id}`);
            return { connection, session };
        };

        try {
            const { connection, session } = await getExistingSession();

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

    private async computeLaunchInfo(): Promise<IJupyterConnection> {
        // First we need our launch information so we can start a new session (that's what our notebook is really)
        let launchInfo = await this.waitForConnect();
        if (!launchInfo) {
            throw this.getDisposedError();
        }
        return launchInfo;
    }

    public async connect(connection: IJupyterConnection, _cancelToken: CancellationToken): Promise<void> {
        traceInfo(`Connecting server kernel ${connection.baseUrl}`);

        // Save our launch info
        this.connection = connection;

        // Indicate connect started
        this.connectPromise.resolve(connection);

        this.connectionInfoDisconnectHandler = this.connection.disconnected((c) => {
            try {
                this.serverExitCode = c;
                traceError(localize.DataScience.jupyterServerCrashed().format(c.toString()));
                this.shutdown().ignoreErrors();
            } catch {
                noop();
            }
        });

        // Indicate we have a new session on the output channel
        this.logRemoteOutput(localize.DataScience.connectingToJupyterUri().format(connection.baseUrl));

        // Create our session manager
        this.sessionManager = (await this.sessionManagerFactory.create(connection)) as JupyterSessionManager;
    }

    public async createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        cancelTokenSource: CancellationTokenSource,
        ui: IDisplayOptions
    ): Promise<INotebook> {
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
                cancelTokenSource,
                ui
            );
            const baseUrl = this.connection?.baseUrl || '';
            this.logRemoteOutput(localize.DataScience.createdNewNotebook().format(baseUrl));
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
                this.sessionManager = undefined;
            }

            // After shutting down notebooks and session manager, kill the main process.
            if (this.connection && this.connection) {
                traceInfo('Shutdown server - dispose conn info');
                this.connection.dispose(); // This should kill the process that's running
                this.connection = undefined;
            }
        } catch (e) {
            traceError(`Error during shutdown: `, e);
        }
    }

    private waitForConnect(): Promise<IJupyterConnection | undefined> {
        return this.connectPromise.promise;
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IJupyterConnection | undefined {
        if (!this.connection) {
            return undefined;
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
            return new Error(localize.DataScience.jupyterServerCrashed().format(this.serverExitCode.toString()));
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
