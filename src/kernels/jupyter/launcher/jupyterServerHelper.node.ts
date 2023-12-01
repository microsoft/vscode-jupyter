// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import uuid from 'uuid/v4';
import { CancellationToken, Uri, workspace } from 'vscode';
import { inject, injectable, optional } from 'inversify';
import { traceError, traceInfo, traceVerbose } from '../../../platform/logging';
import {
    IDisposableRegistry,
    IAsyncDisposableRegistry,
    IConfigurationService,
    Resource
} from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IJupyterServerHelper, INotebookStarter } from '../types';
import * as urlPath from '../../../platform/vscode-path/resources';
import { IJupyterSubCommandExecutionService } from '../types.node';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { DataScience } from '../../../platform/common/utils/localize';
import { raceCancellationError } from '../../../platform/common/cancellation';
import { IJupyterConnection } from '../../types';
import { JupyterWaitForIdleError } from '../../errors/jupyterWaitForIdleError';
import { expandWorkingDir } from '../jupyterUtils';
import { noop } from '../../../platform/common/utils/misc';
import { getRootFolder } from '../../../platform/common/application/workspace.base';
import { computeWorkingDirectory } from '../../../platform/common/application/workspace.node';

/**
 * Jupyter server implementation that uses the JupyterExecutionBase class to launch Jupyter.
 */
@injectable()
export class JupyterServerHelper implements IJupyterServerHelper {
    private usablePythonInterpreter: PythonEnvironment | undefined;
    private cache?: Promise<IJupyterConnection>;
    private disposed: boolean = false;
    private _disposed = false;
    constructor(
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(INotebookStarter) @optional() private readonly notebookStarter: INotebookStarter | undefined,
        @inject(IJupyterSubCommandExecutionService)
        @optional()
        private readonly jupyterInterpreterService: IJupyterSubCommandExecutionService | undefined
    ) {
        this.disposableRegistry.push(this.interpreterService.onDidChangeInterpreter(() => this.onSettingsChanged()));
        this.disposableRegistry.push(this);

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
        asyncRegistry.push(this);
    }

    public async dispose(): Promise<void> {
        traceInfo(`Disposing HostJupyterExecution`);
        if (!this._disposed) {
            this._disposed = true;
            traceVerbose(`Disposing super HostJupyterExecution`);
            this.disposed = true;

            // Cleanup on dispose. We are going away permanently
            traceVerbose(`Cleaning up server cache`);
            await this.cache?.then((s) => s.dispose()).catch(noop);
        }
        traceVerbose(`Finished disposing HostJupyterExecution`);
    }

    public async startServer(resource: Resource, cancelToken: CancellationToken): Promise<IJupyterConnection> {
        if (this._disposed) {
            throw new Error('Notebook server is disposed');
        }
        if (!this.cache) {
            const promise = (this.cache = this.startJupyterWithRetry(resource, cancelToken));
            promise.catch((ex) => {
                traceError(`Failed to start the Jupyter Server`, ex);
                if (this.cache === promise) {
                    this.cache = undefined;
                }
            });
        }

        return this.cache;
    }
    public async refreshCommands(): Promise<void> {
        await this.jupyterInterpreterService?.refreshCommands();
    }

    public async isJupyterServerSupported(cancelToken?: CancellationToken): Promise<boolean> {
        // See if we can find the command notebook
        return this.jupyterInterpreterService ? this.jupyterInterpreterService.isNotebookSupported(cancelToken) : false;
    }

    public async getJupyterServerError(): Promise<string> {
        return this.jupyterInterpreterService
            ? this.jupyterInterpreterService.getReasonForJupyterNotebookNotBeingSupported()
            : DataScience.webNotSupported;
    }

    public async getUsableJupyterPython(cancelToken?: CancellationToken): Promise<PythonEnvironment | undefined> {
        // Only try to compute this once.
        if (!this.usablePythonInterpreter && !this.disposed && this.jupyterInterpreterService) {
            this.usablePythonInterpreter = await raceCancellationError(
                cancelToken,
                this.jupyterInterpreterService!.getSelectedInterpreter(cancelToken)
            );
        }
        return this.usablePythonInterpreter;
    }

    /* eslint-disable complexity,  */
    private startJupyterWithRetry(resource: Resource, cancelToken: CancellationToken): Promise<IJupyterConnection> {
        const work = async () => {
            let connection: IJupyterConnection | undefined;

            // Try to connect to our jupyter process. Check our setting for the number of tries
            let tryCount = 1;
            const maxTries = Math.max(1, this.configuration.getSettings(undefined).jupyterLaunchRetries);
            let lastTryError: Error;
            while (tryCount <= maxTries && !this.disposed) {
                try {
                    // Start or connect to the process
                    connection = await this.startImpl(resource, cancelToken);

                    traceVerbose(`Connection complete server`);
                    return connection;
                } catch (err) {
                    lastTryError = err;
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
                        throw err;
                    } else {
                        throw err;
                    }
                }
                throw lastTryError;
            }
            throw new Error('Max number of attempts reached');
        };
        return raceCancellationError(cancelToken, work());
    }

    private async startImpl(resource: Resource, cancelToken: CancellationToken): Promise<IJupyterConnection> {
        // If our uri is undefined or if it's set to local launch we need to launch a server locally
        // If that works, then attempt to start the server
        traceInfo(`Launching server`);
        const settings = this.configuration.getSettings(resource);
        const useDefaultConfig = settings.useDefaultConfigForJupyter;
        const workingDir = await computeWorkingDirectory(resource);
        // Expand the working directory. Create a dummy launching file in the root path (so we expand correctly)
        const rootFolder = getRootFolder();
        const workingDirectory = expandWorkingDir(
            workingDir,
            rootFolder ? urlPath.joinPath(rootFolder, `${uuid()}.txt`) : undefined,
            settings
        );

        if (!this.notebookStarter) {
            // In desktop mode this must be defined, in web this code path never gets executed.
            throw new Error('Notebook Starter cannot be undefined');
        }
        return this.notebookStarter.start(
            resource,
            useDefaultConfig,
            this.configuration.getSettings(undefined).jupyterCommandLineArguments,
            Uri.file(workingDirectory),
            cancelToken
        );
    }

    private onSettingsChanged() {
        // Clear our usableJupyterInterpreter so that we recompute our values
        this.usablePythonInterpreter = undefined;
    }
}
