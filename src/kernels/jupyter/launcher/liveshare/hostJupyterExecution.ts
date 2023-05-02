// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import uuid from 'uuid/v4';
import { CancellationToken, Uri } from 'vscode';
import { ServerCache } from './serverCache';
import { inject, injectable, optional } from 'inversify';
import { IWorkspaceService } from '../../../../platform/common/application/types';
import { traceInfo, traceVerbose, traceWarning } from '../../../../platform/logging';
import {
    IDisposableRegistry,
    IAsyncDisposableRegistry,
    IConfigurationService
} from '../../../../platform/common/types';
import { testOnlyMethod } from '../../../../platform/common/utils/decorators';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';
import {
    IJupyterExecution,
    INotebookServerOptions,
    INotebookServer,
    INotebookStarter,
    INotebookServerFactory,
    IJupyterServerUriStorage
} from '../../types';
import * as urlPath from '../../../../platform/vscode-path/resources';
import { IJupyterSubCommandExecutionService } from '../../types.node';
import { JupyterConnection } from '../../connection/jupyterConnection';
import { PythonEnvironment } from '../../../../platform/pythonEnvironments/info';
import { DataScience } from '../../../../platform/common/utils/localize';
import { Cancellation } from '../../../../platform/common/cancellation';
import { IJupyterConnection } from '../../../types';
import { JupyterSelfCertsError } from '../../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../../platform/errors/jupyterSelfCertsExpiredError';
import { LocalJupyterServerConnectionError } from '../../../../platform/errors/localJupyterServerConnectionError';
import { RemoteJupyterServerConnectionError } from '../../../../platform/errors/remoteJupyterServerConnectionError';
import { sendTelemetryEvent, Telemetry } from '../../../../telemetry';
import { JupyterWaitForIdleError } from '../../../errors/jupyterWaitForIdleError';
import { expandWorkingDir } from '../../jupyterUtils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LocalHosts = ['localhost', '127.0.0.1', '::1'];

/**
 * Jupyter server implementation that uses the JupyterExecutionBase class to launch Jupyter.
 */
@injectable()
export class HostJupyterExecution implements IJupyterExecution {
    private usablePythonInterpreter: PythonEnvironment | undefined;
    private disposed: boolean = false;
    private serverCache: ServerCache;
    private _disposed = false;
    private _id = uuid();
    constructor(
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(INotebookStarter) @optional() private readonly notebookStarter: INotebookStarter | undefined,
        @inject(IJupyterSubCommandExecutionService)
        @optional()
        private readonly jupyterInterpreterService: IJupyterSubCommandExecutionService | undefined,
        @inject(INotebookServerFactory) private readonly notebookServerFactory: INotebookServerFactory,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection
    ) {
        this.disposableRegistry.push(this.interpreterService.onDidChangeInterpreter(() => this.onSettingsChanged()));
        this.disposableRegistry.push(this);

        if (workspace) {
            workspace.onDidChangeConfiguration(
                (e) => {
                    if (e.affectsConfiguration('python.dataScience', undefined)) {
                        // When config changes happen, recreate our commands.
                        this.onSettingsChanged();
                    }
                },
                this,
                this.disposableRegistry
            );
        }
        this.serverCache = new ServerCache();
        this.serverUriStorage.onDidChangeUri(
            () => {
                this.serverCache.clearCache();
            },
            this,
            disposableRegistry
        );
        asyncRegistry.push(this);
    }

    @testOnlyMethod()
    public clearCache() {
        this.serverCache.clearCache();
    }
    public async dispose(): Promise<void> {
        traceInfo(`Disposing HostJupyterExecution ${this._id}`);
        if (!this._disposed) {
            this._disposed = true;
            traceVerbose(`Disposing super HostJupyterExecution ${this._id}`);
            this.disposed = true;

            // Cleanup on dispose. We are going away permanently
            if (this.serverCache) {
                traceVerbose(`Cleaning up server cache ${this._id}`);
                await this.serverCache.dispose();
            }
        }
        traceVerbose(`Finished disposing HostJupyterExecution  ${this._id}`);
    }

    private async hostConnectToNotebookServer(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer> {
        if (!this._disposed) {
            return this.connectToNotebookServerImpl(
                await this.serverCache.generateDefaultOptions(options),
                cancelToken
            );
        }
        throw new Error('Notebook server is disposed');
    }

    public async connectToNotebookServer(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer> {
        if (!this._disposed) {
            return this.serverCache.getOrCreate(this.hostConnectToNotebookServer.bind(this), options, cancelToken);
        }
        throw new Error('Notebook server is disposed');
    }
    public async getServer(options: INotebookServerOptions): Promise<INotebookServer | undefined> {
        if (!this._disposed) {
            // See if we have this server or not.
            return this.serverCache.get(options);
        }
    }

    public async refreshCommands(): Promise<void> {
        await this.jupyterInterpreterService?.refreshCommands();
    }

    public async isNotebookSupported(cancelToken?: CancellationToken): Promise<boolean> {
        // See if we can find the command notebook
        return this.jupyterInterpreterService ? this.jupyterInterpreterService.isNotebookSupported(cancelToken) : false;
    }

    public async getNotebookError(): Promise<string> {
        return this.jupyterInterpreterService
            ? this.jupyterInterpreterService.getReasonForJupyterNotebookNotBeingSupported()
            : DataScience.webNotSupported;
    }

    public async getUsableJupyterPython(cancelToken?: CancellationToken): Promise<PythonEnvironment | undefined> {
        // Only try to compute this once.
        if (!this.usablePythonInterpreter && !this.disposed && this.jupyterInterpreterService) {
            this.usablePythonInterpreter = await Cancellation.race(
                () => this.jupyterInterpreterService!.getSelectedInterpreter(cancelToken),
                cancelToken
            );
        }
        return this.usablePythonInterpreter;
    }

    /* eslint-disable complexity,  */
    public connectToNotebookServerImpl(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer> {
        // Return nothing if we cancel
        // eslint-disable-next-line
        return Cancellation.race(async () => {
            let result: INotebookServer | undefined;
            let connection: IJupyterConnection | undefined;

            // Try to connect to our jupyter process. Check our setting for the number of tries
            let tryCount = 1;
            const maxTries = Math.max(1, this.configuration.getSettings(undefined).jupyterLaunchRetries);
            let lastTryError: Error;
            while (tryCount <= maxTries && !this.disposed) {
                try {
                    // Start or connect to the process
                    connection = await this.startOrConnect(options, cancelToken);

                    if (!connection.localLaunch && LocalHosts.includes(connection.hostName.toLowerCase())) {
                        sendTelemetryEvent(Telemetry.ConnectRemoteJupyterViaLocalHost);
                    }
                    // eslint-disable-next-line no-constant-condition
                    traceVerbose(`Connecting to process server`);

                    // Create a server tha  t we will then attempt to connect to.
                    result = await this.notebookServerFactory.createNotebookServer(connection);
                    traceVerbose(`Connection complete server`);
                    return result;
                } catch (err) {
                    lastTryError = err;
                    // Cleanup after ourselves. server may be running partially.
                    if (result) {
                        traceWarning(`Killing server because of error ${err}`);
                        await result.dispose();
                    }
                    if (err instanceof JupyterWaitForIdleError && tryCount < maxTries) {
                        // Special case. This sometimes happens where jupyter doesn't ever connect. Cleanup after
                        // ourselves and propagate the failure outwards.
                        traceInfo('Retry because of wait for idle problem.');

                        // Close existing connection.
                        connection?.dispose();
                        tryCount += 1;
                    } else if (connection) {
                        // If this is occurring during shutdown, don't worry about it.
                        if (this.disposed) {
                            throw err;
                        }

                        // Something else went wrong
                        if (!options.localJupyter) {
                            sendTelemetryEvent(Telemetry.ConnectRemoteFailedJupyter, undefined, undefined, err);

                            // Check for the self signed certs error specifically
                            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                                throw new JupyterSelfCertsError(connection.baseUrl);
                            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                                sendTelemetryEvent(Telemetry.ConnectRemoteExpiredCertFailedJupyter);
                                throw new JupyterSelfCertsExpiredError(connection.baseUrl);
                            } else {
                                throw new RemoteJupyterServerConnectionError(connection.baseUrl, options.serverId, err);
                            }
                        } else {
                            sendTelemetryEvent(Telemetry.ConnectFailedJupyter, undefined, undefined, err);
                            throw new LocalJupyterServerConnectionError(err);
                        }
                    } else {
                        throw err;
                    }
                }
                throw lastTryError;
            }
            throw new Error('Max number of attempts reached');
        }, cancelToken);
    }

    private async startOrConnect(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<IJupyterConnection> {
        // If our uri is undefined or if it's set to local launch we need to launch a server locally
        if (options.localJupyter) {
            // If that works, then attempt to start the server
            traceInfo(`Launching server`);
            const settings = this.configuration.getSettings(options.resource);
            const useDefaultConfig = settings.useDefaultConfigForJupyter;
            const workingDir = await this.workspace.computeWorkingDirectory(options.resource);
            // Expand the working directory. Create a dummy launching file in the root path (so we expand correctly)
            const workingDirectory = expandWorkingDir(
                workingDir,
                this.workspace.rootFolder ? urlPath.joinPath(this.workspace.rootFolder, `${uuid()}.txt`) : undefined,
                this.workspace,
                settings
            );

            if (!this.notebookStarter) {
                // In desktop mode this must be defined, in web this code path never gets executed.
                throw new Error('Notebook Starter cannot be undefined');
            }
            return this.notebookStarter!.start(
                options.resource,
                useDefaultConfig,
                this.configuration.getSettings(undefined).jupyterCommandLineArguments,
                Uri.file(workingDirectory),
                cancelToken
            );
        } else {
            // If we have a URI spec up a connection info for it
            return this.jupyterConnection.createConnectionInfo({ serverId: options.serverId });
        }
    }

    private onSettingsChanged() {
        // Clear our usableJupyterInterpreter so that we recompute our values
        this.usablePythonInterpreter = undefined;
    }
}
