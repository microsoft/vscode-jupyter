// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import type * as nbformat from '@jupyterlab/nbformat';
import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { IPythonExtensionChecker } from '../../../api/types';
import { IVSCodeNotebook, IWorkspaceService } from '../../../common/application/types';
import { traceError, traceInfo, traceInfoIfCI } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IOutputChannel,
    Resource
} from '../../../common/types';
import { createDeferred, Deferred, sleep } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { IInterpreterService } from '../../../interpreter/contracts';
import { isResourceNativeNotebook } from '../../notebook/helpers/helpers';
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
import { ILocalKernelFinder, IRemoteKernelFinder } from '../../kernel-launcher/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../../common/constants';
import { inject, injectable, named } from 'inversify';
import { JupyterNotebookBase } from '../jupyterNotebook';
import * as uuid from 'uuid/v4';
import { NotebookDocument } from 'vscode';
import { noop } from '../../../common/utils/misc';
import { Telemetry } from '../../constants';
import { sendKernelTelemetryEvent } from '../../telemetry/telemetry';
import { StopWatch } from '../../../common/utils/stopWatch';
import { JupyterSession } from '../jupyterSession';
import { JupyterSessionManager } from '../jupyterSessionManager';
/* eslint-disable @typescript-eslint/no-explicit-any */

@injectable()
export class HostJupyterServer implements INotebookServer {
    private launchInfo: INotebookServerLaunchInfo | undefined;
    protected readonly id = uuid();
    private connectPromise: Deferred<INotebookServerLaunchInfo> = createDeferred<INotebookServerLaunchInfo>();
    private connectionInfoDisconnectHandler: IDisposable | undefined;
    private serverExitCode: number | undefined;
    private notebooks = new Map<string, Promise<INotebook>>();
    private sessionManager: JupyterSessionManager | undefined;
    private savedSession: JupyterSession | undefined;
    private disposed = false;
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IJupyterSessionManagerFactory) private readonly sessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(ILocalKernelFinder) private readonly localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) private readonly remoteKernelFinder: IRemoteKernelFinder,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly jupyterOutputChannel: IOutputChannel,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook
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
        document: vscode.NotebookDocument,
        sessionManager: JupyterSessionManager,
        possibleSession: JupyterSession | undefined,
        configService: IConfigurationService,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        // See if already exists.
        const existing = await this.getNotebook(document);
        if (existing) {
            // Dispose the possible session as we don't need it
            if (possibleSession) {
                await possibleSession.dispose();
            }

            // Then we can return the existing notebook.
            return existing;
        }

        let progressDisposable: vscode.Disposable | undefined;

        // Compute launch information from the resource and the notebook metadata
        const notebookPromise = createDeferred<INotebook>();
        // Save the notebook
        this.setNotebook(document, notebookPromise.promise);

        const getExistingSession = async () => {
            const { info, changedKernel } = await this.computeLaunchInfo(
                resource,
                notebookMetadata,
                kernelConnection,
                cancelToken
            );

            progressDisposable = this.progressReporter.createProgressIndicator(
                localize.DataScience.connectingToKernel().format(
                    getDisplayNameOrNameOfKernelConnection(info.kernelConnectionMetadata)
                )
            );

            // If we switched kernels, try switching the possible session
            if (changedKernel && possibleSession && info.kernelConnectionMetadata) {
                traceInfo(`Changing Kernel to ${JSON.stringify(info.kernelConnectionMetadata.id)}`);
                await possibleSession.changeKernel(
                    resource,
                    info.kernelConnectionMetadata,
                    this.configService.getSettings(resource).jupyterLaunchTimeout
                );
            }

            // Figure out the working directory we need for our new notebook. This is only necessary for local.
            const workingDirectory = info.connectionInfo.localLaunch
                ? await computeWorkingDirectory(resource, this.workspaceService)
                : '';
            const sessionDirectoryMatches =
                info.connectionInfo.localLaunch && possibleSession
                    ? this.fs.areLocalPathsSame(possibleSession.workingDirectory, workingDirectory)
                    : true;

            // Start a session (or use the existing one if allowed)
            const session =
                possibleSession && sessionDirectoryMatches
                    ? possibleSession
                    : await sessionManager.startNew(
                          resource,
                          info.kernelConnectionMetadata,
                          workingDirectory,
                          cancelToken
                      );
            traceInfo(`Started session ${this.id}`);
            return { info, session };
        };

        try {
            const { info, session } = await getExistingSession();

            if (session) {
                // Create our notebook
                const notebook = new JupyterNotebookBase(session, info, document.uri);

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

    private async computeLaunchInfo(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<{ info: INotebookServerLaunchInfo; changedKernel: boolean }> {
        // First we need our launch information so we can start a new session (that's what our notebook is really)
        let launchInfo = await this.waitForConnect();
        if (!launchInfo) {
            throw this.getDisposedError();
        }
        traceInfo(`Compute Launch Info uri = ${resource?.fsPath}, kernelConnection id = ${kernelConnection?.id}`);
        // Create a copy of launch info, cuz we're modifying it here.
        // This launch info contains the server connection info (that could be shared across other nbs).
        // However the kernel info is different. The kernel info is stored as a  property of this, hence create a separate instance for each nb.
        launchInfo = {
            ...launchInfo
        };

        // Determine the interpreter for our resource. If different, we need a different kernel. This is unnecessary in remote
        const resourceInterpreter =
            this.extensionChecker.isPythonExtensionInstalled && launchInfo.connectionInfo.localLaunch
                ? await this.interpreterService.getActiveInterpreter(resource)
                : undefined;

        // Find a kernel that can be used.
        // Do this only if we don't have any kernel connection information, or the resource's interpreter is different.
        let changedKernel = false;
        if (
            // For local connections this code path is not executed for native notebooks (hence only for remote).
            (isResourceNativeNotebook(resource, this.vscodeNotebook, this.fs) &&
                !launchInfo.connectionInfo.localLaunch) ||
            !kernelConnection ||
            notebookMetadata?.kernelspec ||
            resourceInterpreter?.displayName !== launchInfo.kernelConnectionMetadata?.interpreter?.displayName
        ) {
            let kernelInfo: KernelConnectionMetadata | undefined;
            if (!launchInfo.connectionInfo.localLaunch && kernelConnection?.kind === 'connectToLiveKernel') {
                traceInfoIfCI(`kernelConnection?.kind === 'connectToLiveKernel'`);
                kernelInfo = kernelConnection;
            } else if (!launchInfo.connectionInfo.localLaunch && kernelConnection?.kind === 'startUsingKernelSpec') {
                traceInfoIfCI(`kernelConnection?.kind === 'startUsingKernelSpec'`);
                kernelInfo = kernelConnection;
            } else if (launchInfo.connectionInfo.localLaunch && kernelConnection) {
                traceInfoIfCI(`launchInfo.connectionInfo.localLaunch && kernelConnection'`);
                kernelInfo = kernelConnection;
            } else {
                kernelInfo = await (launchInfo.connectionInfo.localLaunch
                    ? this.localKernelFinder.findKernel(resource, notebookMetadata, cancelToken)
                    : this.remoteKernelFinder.findKernel(
                          resource,
                          launchInfo.connectionInfo,
                          notebookMetadata,
                          cancelToken
                      ));
                traceInfoIfCI(`kernelInfo found ${kernelInfo?.id}`);
            }
            if (kernelInfo && kernelInfo.id !== launchInfo.kernelConnectionMetadata?.id) {
                // Update kernel info if we found a new one.
                launchInfo.kernelConnectionMetadata = kernelInfo;
                changedKernel = true;
            }
            traceInfo(
                `Compute Launch Info uri = ${resource?.fsPath}, changed ${changedKernel}, ${launchInfo.kernelConnectionMetadata?.id}`
            );
        }
        if (!changedKernel && kernelConnection && kernelConnection.id !== launchInfo.kernelConnectionMetadata?.id) {
            // Update kernel info if its different from what was originally provided.
            traceInfoIfCI(`kernelConnection provided is different from launch info ${kernelConnection.id}`);
            launchInfo.kernelConnectionMetadata = kernelConnection;
            changedKernel = true;
        }

        traceInfo(
            `Computed Launch Info uri = ${resource?.fsPath}, changed ${changedKernel}, ${launchInfo.kernelConnectionMetadata?.id}`
        );
        return { info: launchInfo, changedKernel };
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, cancelToken?: CancellationToken): Promise<void> {
        traceInfo(
            `Connecting server ${this.id} kernelSpec ${getDisplayNameOrNameOfKernelConnection(
                launchInfo.kernelConnectionMetadata,
                'unknown'
            )}`
        );

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

        // Try creating a session just to ensure we're connected. Callers of this function check to make sure jupyter
        // is running and connectable.
        const session = (await this.sessionManager.startNew(
            undefined,
            launchInfo.kernelConnectionMetadata,
            launchInfo.connectionInfo.rootDirectory,
            cancelToken,
            launchInfo.disableUI
        )) as JupyterSession;
        const idleTimeout = this.configService.getSettings().jupyterLaunchTimeout;
        // The wait for idle should throw if we can't connect.
        await session.waitForIdle(idleTimeout);

        // For local we want to save this for the next notebook to use.
        if (this.launchInfo.connectionInfo.localLaunch) {
            this.savedSession = session;
        } else {
            // Otherwise for remote, just get rid of it.
            await session.dispose();
        }
    }

    public async createNotebook(
        resource: Resource,
        document: NotebookDocument,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        if (!this.sessionManager || this.isDisposed) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        // If we have a saved session send this into the notebook so we don't create a new one
        const savedSession = this.savedSession;
        this.savedSession = undefined;
        const stopWatch = new StopWatch();
        // Create a notebook and return it.
        try {
            const notebook = await this.createNotebookInstance(
                resource,
                document,
                this.sessionManager,
                savedSession,
                this.configService,
                notebookMetadata,
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

            // Destroy the kernel spec
            await this.destroyKernelSpec();

            // Remove the saved session if we haven't passed it onto a notebook
            if (this.savedSession) {
                await this.savedSession.dispose();
                this.savedSession = undefined;
            }

            traceInfo(`Shutting down notebooks for ${this.id}`);
            const notebooks = await Promise.all([...this.notebooks.values()]);
            await Promise.all(notebooks.map((n) => n?.dispose()));
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
        return new Error(localize.DataScience.sessionDisposed());
    }

    public async getNotebook(document: NotebookDocument): Promise<INotebook | undefined> {
        return this.notebooks.get(document.uri.toString());
    }

    protected getNotebooks(): Promise<INotebook>[] {
        return [...this.notebooks.values()];
    }

    protected setNotebook(document: NotebookDocument, notebook: Promise<INotebook>) {
        const removeNotebook = () => {
            if (this.notebooks.get(document.uri.toString()) === notebook) {
                this.notebooks.delete(document.uri.toString());
            }
        };

        notebook
            .then((nb) => {
                const oldDispose = nb.dispose.bind(nb);
                nb.dispose = () => {
                    this.notebooks.delete(document.uri.toString());
                    return oldDispose();
                };
            })
            .catch(removeNotebook);

        // Save the notebook
        this.notebooks.set(document.uri.toString(), notebook);
    }

    private async destroyKernelSpec() {
        if (this.launchInfo) {
            this.launchInfo.kernelConnectionMetadata = undefined;
        }
    }

    private logRemoteOutput(output: string) {
        if (this.launchInfo && !this.launchInfo.connectionInfo.localLaunch) {
            this.jupyterOutputChannel.appendLine(output);
        }
    }
}
