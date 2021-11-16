// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { CancellationError } from '../../common/cancellation';
import { disposeAllDisposables } from '../../common/helpers';
import { traceInfo } from '../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { IInterpreterService } from '../../interpreter/contracts';
import { Settings } from '../constants';
import { DisplayOptions } from '../displayOptions';
import { JupyterInstallError } from '../errors/jupyterInstallError';
import { JupyterServerSelector } from '../jupyter/serverSelector';
import { ProgressReporter } from '../progress/progressReporter';
import {
    GetServerOptions,
    IJupyterExecution,
    IJupyterServerProvider,
    IJupyterServerUriStorage,
    INotebookServer,
    INotebookServerOptions
} from '../types';

@injectable()
export class NotebookServerProvider implements IJupyterServerProvider {
    private serverPromise: Promise<INotebookServer | undefined> | undefined;
    private ui = new DisplayOptions(true);
    constructor(
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IJupyterExecution) private readonly jupyterExecution: IJupyterExecution,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterServerSelector) private serverSelector: JupyterServerSelector,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public async getOrCreateServer(options: GetServerOptions): Promise<INotebookServer | undefined> {
        const serverOptions = await this.getNotebookServerOptions(options.resource);

        // If we are just fetching or only want to create for local, see if exists
        if (options.getOnly || (options.localOnly && !serverOptions.uri)) {
            return this.jupyterExecution.getServer(serverOptions);
        } else {
            // Otherwise create a new server
            return this.createServer(options);
        }
    }

    private async createServer(options: GetServerOptions): Promise<INotebookServer | undefined> {
        // When we finally try to create a server, update our flag indicating if we're going to allow UI or not. This
        // allows the server to be attempted without a UI, but a future request can come in and use the same startup
        if (!options.ui.disableUI) {
            this.ui.disableUI = false;
        }
        options.ui.onDidChangeDisableUI(() => (this.ui.disableUI = options.ui.disableUI), this, this.disposables);

        if (!this.serverPromise) {
            // Start a server
            this.serverPromise = this.startServer(options.resource, options.token);
        }
        try {
            const value = await this.serverPromise;
            return value;
        } catch (e) {
            // Don't cache the error
            this.serverPromise = undefined;
            throw e;
        }
    }

    private async startServer(resource: Resource, token: CancellationToken): Promise<INotebookServer | undefined> {
        const serverOptions = await this.getNotebookServerOptions(resource);
        traceInfo(`Checking for server existence.`);

        // If the URI is 'remote' then the encrypted storage is not working. Ask user again for server URI
        if (serverOptions.uri === Settings.JupyterServerRemoteLaunch) {
            await this.serverSelector.selectJupyterURI(true);
            // Should have been saved
            serverOptions.uri = await this.serverUriStorage.getUri();
        }

        const disposables: IDisposable[] = [];
        // Status depends upon if we're about to connect to existing server or not.
        let progressReporter =
            this.ui.disableUI === false
                ? (await this.jupyterExecution.getServer(serverOptions))
                    ? this.progressReporter.createProgressIndicator(localize.DataScience.connectingToJupyter())
                    : this.progressReporter.createProgressIndicator(localize.DataScience.startingJupyter())
                : undefined;
        if (progressReporter) {
            disposables.push(progressReporter);
        } else {
            this.ui.onDidChangeDisableUI(
                async () => {
                    if (!progressReporter && !this.ui.disableUI) {
                        progressReporter = (await this.jupyterExecution.getServer(serverOptions))
                            ? this.progressReporter.createProgressIndicator(localize.DataScience.connectingToJupyter())
                            : this.progressReporter.createProgressIndicator(localize.DataScience.startingJupyter());
                        disposables.push(progressReporter);
                    }
                },
                this,
                disposables
            );
        }
        // Check to see if we support ipykernel or not
        try {
            traceInfo(`Checking for server usability.`);

            const usable = await this.checkUsable(serverOptions);
            if (!usable) {
                traceInfo('Server not usable (should ask for install now)');
                // Indicate failing.
                throw new JupyterInstallError(
                    localize.DataScience.jupyterNotSupported().format(await this.jupyterExecution.getNotebookError()),
                    localize.DataScience.pythonInteractiveHelpLink()
                );
            }
            // Then actually start the server
            traceInfo(`Starting notebook server.`);
            const result = await this.jupyterExecution.connectToNotebookServer(serverOptions, token);
            traceInfo(`Server started.`);
            return result;
        } catch (e) {
            progressReporter?.dispose(); // NOSONAR
            // If user cancelled, then do nothing.
            if (progressReporter && progressReporter.token.isCancellationRequested && e instanceof CancellationError) {
                return;
            }

            // Also tell jupyter execution to reset its search. Otherwise we've just cached
            // the failure there
            await this.jupyterExecution.refreshCommands();

            throw e;
        } finally {
            disposeAllDisposables(disposables);
        }
    }

    private async checkUsable(options: INotebookServerOptions): Promise<boolean> {
        try {
            if (options && !options.uri) {
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
                    : activeInterpreter.path;
                throw new Error(
                    localize.DataScience.jupyterNotSupportedBecauseOfEnvironment().format(displayName, e.toString())
                );
            } else {
                throw new JupyterInstallError(
                    localize.DataScience.jupyterNotSupported().format(await this.jupyterExecution.getNotebookError()),
                    localize.DataScience.pythonInteractiveHelpLink()
                );
            }
        }
    }

    private async getNotebookServerOptions(resource: Resource): Promise<INotebookServerOptions> {
        // Since there's one server per session, don't use a resource to figure out these settings
        let serverURI: string | undefined = await this.serverUriStorage.getUri();
        const useDefaultConfig: boolean | undefined = this.configuration.getSettings(undefined)
            .useDefaultConfigForJupyter;

        // For the local case pass in our URI as undefined, that way connect doesn't have to check the setting
        if (serverURI && serverURI.toLowerCase() === Settings.JupyterServerLocalLaunch) {
            serverURI = undefined;
        }

        return {
            uri: serverURI,
            resource,
            skipUsingDefaultConfig: !useDefaultConfig,
            ui: this.ui
        };
    }
}
