// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { traceVerbose } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { GetServerOptions, IJupyterConnection } from '../../types';
import { IJupyterServerProvider, IJupyterExecution } from '../types';
import { NotSupportedInWebError } from '../../../platform/errors/notSupportedInWebError';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { Cancellation, isCancellationError } from '../../../platform/common/cancellation';

@injectable()
export class NotebookServerProvider implements IJupyterServerProvider {
    private serverPromise?: Promise<IJupyterConnection>;
    constructor(
        @inject(IJupyterExecution) @optional() private readonly jupyterExecution: IJupyterExecution | undefined,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    public async getOrCreateServer(options: GetServerOptions): Promise<IJupyterConnection> {
        // If we are just fetching or only want to create for local, see if exists
        if (this.jupyterExecution) {
            const server = await this.jupyterExecution.getServer(options.resource);
            // Possible it wasn't created, hence create it.
            if (server) {
                return server;
            }
        }

        // Otherwise create a new server
        return this.createServer(options);
    }

    private async createServer(options: GetServerOptions): Promise<IJupyterConnection> {
        if (!this.serverPromise) {
            // Start a server
            const promise = (this.serverPromise = this.startServer(options));
            promise.catch(() => {
                if (promise === this.serverPromise) {
                    this.serverPromise = undefined;
                }
            });
        }
        return this.serverPromise;
    }

    private async startServer(options: GetServerOptions): Promise<IJupyterConnection> {
        const jupyterExecution = this.jupyterExecution;
        if (!jupyterExecution) {
            throw new NotSupportedInWebError();
        }

        // Check to see if we support ipykernel or not
        try {
            traceVerbose(`Checking for server usability.`);

            const usable = await this.checkUsable();
            if (!usable) {
                traceVerbose('Server not usable (should ask for install now)');
                // Indicate failing.
                throw new JupyterInstallError(
                    DataScience.jupyterNotSupported(await jupyterExecution.getNotebookError())
                );
            }
            // Then actually start the server
            traceVerbose(`Starting notebook server.`);
            const result = await jupyterExecution.connectToNotebookServer(options.resource, options.token);
            Cancellation.throwIfCanceled(options.token);
            return result;
        } catch (e) {
            // If user cancelled, then do nothing.
            if (options.token?.isCancellationRequested && isCancellationError(e)) {
                throw e;
            }

            // Also tell jupyter execution to reset its search. Otherwise we've just cached
            // the failure there
            await jupyterExecution.refreshCommands();

            throw e;
        }
    }

    private async checkUsable(): Promise<boolean> {
        try {
            if (this.jupyterExecution) {
                const usableInterpreter = await this.jupyterExecution.getUsableJupyterPython();
                return usableInterpreter ? true : false;
            } else {
                return true;
            }
        } catch (e) {
            const activeInterpreter = await this.interpreterService.getActiveInterpreter(undefined);
            // Can't find a usable interpreter, show the error.
            if (activeInterpreter) {
                const displayName = activeInterpreter.displayName
                    ? activeInterpreter.displayName
                    : getFilePath(activeInterpreter.uri);
                throw new Error(DataScience.jupyterNotSupportedBecauseOfEnvironment(displayName, e.toString()));
            } else {
                throw new JupyterInstallError(
                    DataScience.jupyterNotSupported(
                        this.jupyterExecution ? await this.jupyterExecution.getNotebookError() : 'Error'
                    )
                );
            }
        }
    }
}
