// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { IWorkspaceService } from '../../../common/application/types';
import { traceError, traceInfo } from '../../../common/logger';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IOutputChannel,
    Resource
} from '../../../common/types';
import { createDeferred, Deferred, sleep } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { ProgressReporter } from '../../progress/progressReporter';
import {
    IJupyterConnection,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookServer,
    INotebookServerLaunchInfo
} from '../../types';
import { computeWorkingDirectory } from '../jupyterUtils';
import { getDisplayNameOrNameOfKernelConnection } from '../kernels/helpers';
import { KernelConnectionMetadata } from '../kernels/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../../common/constants';
import { inject, injectable, named } from 'inversify';
import { JupyterNotebook } from '../jupyterNotebook';
import * as uuid from 'uuid/v4';
import { noop } from '../../../common/utils/misc';
import { Telemetry } from '../../constants';
import { sendKernelTelemetryEvent } from '../../telemetry/telemetry';
import { StopWatch } from '../../../common/utils/stopWatch';
import { JupyterSessionManager } from '../jupyterSessionManager';
import { SessionDisposedError } from '../../errors/sessionDisposedError';
/* eslint-disable @typescript-eslint/no-explicit-any */

@injectable()
export class HostJupyterServer implements INotebookServer {
    private launchInfo: INotebookServerLaunchInfo | undefined;
    protected readonly id = uuid();
    private connectPromise: Deferred<INotebookServerLaunchInfo> = createDeferred<INotebookServerLaunchInfo>();
    private connectionInfoDisconnectHandler: IDisposable | undefined;
    private serverExitCode: number | undefined;
    private notebooks = new Set<Promise<INotebook>>();
    private sessionManager: JupyterSessionManager | undefined;
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IJupyterSessionManagerFactory) private readonly sessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly jupyterOutputChannel: IOutputChannel,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
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

    protected get isDisposed() {
        return this.disposed;
    }

    protected async createNotebookInstance(
        resource: Resource,
        sessionManager: JupyterSessionManager,
        configService: IConfigurationService,
        kernelConnection: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        let progressDisposable: vscode.Disposable | undefined;

        // Compute launch information from the resource and the notebook metadata
        const notebookPromise = createDeferred<INotebook>();
        // Save the notebook
        this.trackDisposable(notebookPromise.promise);

        const getExistingSession = async () => {
            const info = await this.computeLaunchInfo();

            progressDisposable = this.progressReporter.createProgressIndicator(
                localize.DataScience.connectingToKernel().format(
                    getDisplayNameOrNameOfKernelConnection(kernelConnection)
                )
            );

            // Figure out the working directory we need for our new notebook. This is only necessary for local.
            const workingDirectory = info.connectionInfo.localLaunch
                ? await computeWorkingDirectory(resource, this.workspaceService)
                : '';
            // Start a session (or use the existing one if allowed)
            const session = await sessionManager.startNew(resource, kernelConnection, workingDirectory, cancelToken);
            traceInfo(`Started session ${this.id}`);
            return { info, session };
        };

        try {
            const { info, session } = await getExistingSession();

            if (session) {
                // Create our notebook
                const notebook = new JupyterNotebook(session, info.connectionInfo);

                // Wait for it to be ready
                traceInfo(`Waiting for idle (session) ${this.id}`);
                const idleTimeout = configService.getSettings().jupyterLaunchTimeout;
                await notebook.session.waitForIdle(idleTimeout);

                traceInfo(`Finished connecting ${this.id}`);

                notebookPromise.resolve(notebook);
            } else {
                notebookPromise.reject(this.getDisposedError());
            }
        } catch (ex) {
            // If there's an error, then reject the promise that is returned.
            // This original promise must be rejected as it is cached (check `setNotebook`).
            notebookPromise.reject(ex);
        } finally {
            progressDisposable?.dispose();
        }

        return notebookPromise.promise;
    }

    private async computeLaunchInfo(): Promise<INotebookServerLaunchInfo> {
        // First we need our launch information so we can start a new session (that's what our notebook is really)
        let launchInfo = await this.waitForConnect();
        if (!launchInfo) {
            throw this.getDisposedError();
        }
        return launchInfo;
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, _cancelToken?: CancellationToken): Promise<void> {
        traceInfo(`Connecting server ${this.id}`);

        // Save our launch info
        this.launchInfo = launchInfo;

        // Indicate connect started
        this.connectPromise.resolve(launchInfo);

        // Listen to the process going down
        if (this.launchInfo && this.launchInfo.connectionInfo) {
            this.connectionInfoDisconnectHandler = this.launchInfo.connectionInfo.disconnected((c) => {
                try {
                    this.serverExitCode = c;
                    traceError(localize.DataScience.jupyterServerCrashed().format(c.toString()));
                    this.shutdown().ignoreErrors();
                } catch {
                    noop();
                }
            });
        }

        // Indicate we have a new session on the output channel
        this.logRemoteOutput(localize.DataScience.connectingToJupyterUri().format(launchInfo.connectionInfo.baseUrl));

        // Create our session manager
        this.sessionManager = (await this.sessionManagerFactory.create(
            launchInfo.connectionInfo
        )) as JupyterSessionManager;
    }

    public async createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        cancelToken?: CancellationToken
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
                this.configService,
                kernelConnection,
                cancelToken
            );
            const baseUrl = this.launchInfo?.connectionInfo.baseUrl || '';
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

    protected async shutdown(): Promise<void> {
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

            traceInfo(`Shutting down notebooks for ${this.id}`);
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
            if (this.launchInfo && this.launchInfo.connectionInfo) {
                traceInfo('Shutdown server - dispose conn info');
                this.launchInfo.connectionInfo.dispose(); // This should kill the process that's running
                this.launchInfo = undefined;
            }
        } catch (e) {
            traceError(`Error during shutdown: `, e);
        }
    }

    protected waitForConnect(): Promise<INotebookServerLaunchInfo | undefined> {
        return this.connectPromise.promise;
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IJupyterConnection | undefined {
        if (!this.launchInfo) {
            return undefined;
        }

        // Return a copy with a no-op for dispose
        return {
            ...this.launchInfo.connectionInfo,
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
    protected trackDisposable(notebook: Promise<INotebook>) {
        notebook
            .then((nb) => {
                nb.session.onDidDispose(() => this.notebooks.delete(notebook), this, this.disposables);
            })
            .catch(() => this.notebooks.delete(notebook));

        // Save the notebook
        this.notebooks.add(notebook);
    }

    private logRemoteOutput(output: string) {
        if (this.launchInfo && !this.launchInfo.connectionInfo.localLaunch) {
            this.jupyterOutputChannel.appendLine(output);
        }
    }
}
