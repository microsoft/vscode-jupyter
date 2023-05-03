// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { traceVerbose } from '../../../platform/logging';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { testOnlyMethod } from '../../../platform/common/utils/decorators';
import { DataScience } from '../../../platform/common/utils/localize';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DisplayOptions } from '../../displayOptions';
import { GetServerOptions } from '../../types';
import {
    IJupyterServerProvider,
    INotebookServer,
    IJupyterExecution,
    IJupyterServerUriStorage,
    INotebookServerLocalOptions
} from '../types';
import { NotSupportedInWebError } from '../../../platform/errors/notSupportedInWebError';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { isCancellationError } from '../../../platform/common/cancellation';

/**
 * Starts jupyter servers locally.
 */
const localCacheKey = 'LocalJupyterSererCacheKey';
@injectable()
export class NotebookServerProvider implements IJupyterServerProvider {
    private serverPromise = new Map<string, Promise<INotebookServer>>();
    private ui = new DisplayOptions(true);
    constructor(
        @inject(IJupyterExecution) @optional() private readonly jupyterExecution: IJupyterExecution | undefined,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IJupyterServerUriStorage) serverUriStorage: IJupyterServerUriStorage,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        serverUriStorage.onDidChangeUri(
            () => {
                // Possible user selected another Server.
                const localCache = this.serverPromise.get('local');
                this.serverPromise.clear();
                // Restore the cache for local servers.
                if (localCache) {
                    this.serverPromise.set(localCacheKey, localCache);
                }
            },
            this,
            this.disposables
        );
    }
    @testOnlyMethod()
    public clearCache() {
        this.serverPromise.clear();
    }
    public async getOrCreateServer(options: GetServerOptions): Promise<INotebookServer> {
        const serverOptions = this.getNotebookServerOptions(options);

        // If we are just fetching or only want to create for local, see if exists
        if (this.jupyterExecution) {
            const server = await this.jupyterExecution.getServer(serverOptions);
            // Possible it wasn't created, hence create it.
            if (server) {
                return server;
            }
        }

        // Otherwise create a new server
        return this.createServer(options);
    }

    private async createServer(options: GetServerOptions): Promise<INotebookServer> {
        // When we finally try to create a server, update our flag indicating if we're going to allow UI or not. This
        // allows the server to be attempted without a UI, but a future request can come in and use the same startup
        if (!options.ui.disableUI) {
            this.ui.disableUI = false;
        }
        options.ui.onDidChangeDisableUI(() => (this.ui.disableUI = options.ui.disableUI), this, this.disposables);
        const cacheKey = localCacheKey;
        if (!this.serverPromise.has(cacheKey)) {
            // Start a server
            this.serverPromise.set(cacheKey, this.startServer(options));
        }
        try {
            const value = await this.serverPromise.get(cacheKey)!;
            // If we cancelled starting of the server, then don't cache the result.
            if (!value && options.token?.isCancellationRequested) {
                this.serverPromise.delete(cacheKey);
            }
            return value;
        } catch (e) {
            // Don't cache the error
            this.serverPromise.delete(cacheKey);
            throw e;
        }
    }

    private async startServer(options: GetServerOptions): Promise<INotebookServer> {
        const jupyterExecution = this.jupyterExecution;
        if (!jupyterExecution) {
            throw new NotSupportedInWebError();
        }
        const serverOptions = this.getNotebookServerOptions(options);

        const disposables: IDisposable[] = [];
        let progressReporter: IDisposable | undefined;
        const createProgressReporter = async () => {
            if (this.ui.disableUI || progressReporter) {
                return;
            }
            // Status depends upon if we're about to connect to existing server or not.
            progressReporter = KernelProgressReporter.createProgressReporter(
                options.resource,
                DataScience.startingJupyter
            );
            disposables.push(progressReporter);
        };
        if (this.ui.disableUI) {
            this.ui.onDidChangeDisableUI(createProgressReporter, this, disposables);
        }
        // Check to see if we support ipykernel or not
        try {
            await createProgressReporter();
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
            return await jupyterExecution.connectToNotebookServer(serverOptions, options.token);
        } catch (e) {
            disposeAllDisposables(disposables);
            // If user cancelled, then do nothing.
            if (options.token?.isCancellationRequested && isCancellationError(e)) {
                throw e;
            }

            // Also tell jupyter execution to reset its search. Otherwise we've just cached
            // the failure there
            await jupyterExecution.refreshCommands();

            throw e;
        } finally {
            disposeAllDisposables(disposables);
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

    private getNotebookServerOptions(options: GetServerOptions): INotebookServerLocalOptions {
        return {
            resource: options.resource,
            ui: this.ui
        };
    }
}
