// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { CancellationTokenSource } from 'vscode';
import { CancellationError } from '../../common/cancellation';
import { disposeAllDisposables } from '../../common/helpers';
import { traceInfo } from '../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../common/types';
import { testOnlyMethod } from '../../common/utils/decorators';
import * as localize from '../../common/utils/localize';
import { IInterpreterService } from '../../interpreter/contracts';
import { Settings } from '../constants';
import { DisplayOptions } from '../displayOptions';
import { JupyterInstallError } from '../errors/jupyterInstallError';
import { JupyterServerSelector } from '../jupyter/serverSelector';
import { KernelProgressReporter } from '../progress/kernelProgressReporter';
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
    private serverPromise: {
        local?: Promise<INotebookServer | undefined> | undefined;
        remote?: Promise<INotebookServer | undefined> | undefined;
    } = {};
    private ui = new DisplayOptions(true);
    constructor(
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IJupyterExecution) private readonly jupyterExecution: IJupyterExecution,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterServerSelector) private serverSelector: JupyterServerSelector,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        serverUriStorage.onDidChangeUri(
            () => {
                // Possible user selected another Server.
                this.serverPromise.remote = undefined;
            },
            this,
            this.disposables
        );
    }
    @testOnlyMethod()
    public clearCache() {
        this.serverPromise.local = undefined;
        this.serverPromise.remote = undefined;
    }
    public async getOrCreateServer(options: GetServerOptions): Promise<INotebookServer | undefined> {
        const serverOptions = await this.getNotebookServerOptions(options.resource, options.localJupyter === true);

        // If we are just fetching or only want to create for local, see if exists
        if (options.localJupyter && !serverOptions.uri) {
            const server = await this.jupyterExecution.getServer(serverOptions);
            // Possible it wasn't created, hence create it.
            if (server) {
                return server;
            }
        }

        // Otherwise create a new server
        return this.createServer(options);
    }

    private async createServer(options: GetServerOptions): Promise<INotebookServer | undefined> {
        // When we finally try to create a server, update our flag indicating if we're going to allow UI or not. This
        // allows the server to be attempted without a UI, but a future request can come in and use the same startup
        if (!options.ui.disableUI) {
            this.ui.disableUI = false;
        }
        options.ui.onDidChangeDisableUI(() => (this.ui.disableUI = options.ui.disableUI), this, this.disposables);
        const property = options.localJupyter ? 'local' : 'remote';
        if (!this.serverPromise[property]) {
            // Start a server
            this.serverPromise[property] = this.startServer(
                options.resource,
                options.tokenSource,
                options.localJupyter
            );
        }
        try {
            const value = await this.serverPromise[property];
            return value;
        } catch (e) {
            // Don't cache the error
            this.serverPromise[property] = undefined;
            throw e;
        }
    }

    private async startServer(
        resource: Resource,
        tokenSource: CancellationTokenSource,
        forLocal: boolean
    ): Promise<INotebookServer | undefined> {
        const serverOptions = await this.getNotebookServerOptions(resource, forLocal);
        traceInfo(`Checking for server existence.`);

        // If the URI is 'remote' then the encrypted storage is not working. Ask user again for server URI
        if (serverOptions.uri === Settings.JupyterServerRemoteLaunch) {
            await this.serverSelector.selectJupyterURI(true);
            // Should have been saved
            serverOptions.uri = await this.serverUriStorage.getUri();
        }

        const disposables: IDisposable[] = [];
        let progressReporter: IDisposable | undefined;
        const createProgressReporter = async () => {
            if (this.ui.disableUI || progressReporter) {
                return;
            }
            // Status depends upon if we're about to connect to existing server or not.
            progressReporter = (await this.jupyterExecution.getServer(serverOptions))
                ? KernelProgressReporter.createProgressReporter(resource, localize.DataScience.connectingToJupyter())
                : KernelProgressReporter.createProgressReporter(resource, localize.DataScience.startingJupyter());
            disposables.push(progressReporter);
        };
        if (this.ui.disableUI) {
            this.ui.onDidChangeDisableUI(createProgressReporter, this, disposables);
        }
        // Check to see if we support ipykernel or not
        try {
            await createProgressReporter();
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
            const result = await this.jupyterExecution.connectToNotebookServer(serverOptions, tokenSource);
            traceInfo(`Server started.`);
            return result;
        } catch (e) {
            disposeAllDisposables(disposables);
            // If user cancelled, then do nothing.
            if (tokenSource.token.isCancellationRequested && e instanceof CancellationError) {
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

    private async getNotebookServerOptions(resource: Resource, forLocal: boolean): Promise<INotebookServerOptions> {
        // Since there's one server per session, don't use a resource to figure out these settings
        let serverURI: string | undefined = await this.serverUriStorage.getUri();
        const useDefaultConfig: boolean | undefined = this.configuration.getSettings(undefined)
            .useDefaultConfigForJupyter;

        // For the local case pass in our URI as undefined, that way connect doesn't have to check the setting
        if (forLocal || (serverURI && serverURI.toLowerCase() === Settings.JupyterServerLocalLaunch)) {
            serverURI = undefined;
        }

        return {
            uri: serverURI,
            resource,
            skipUsingDefaultConfig: !useDefaultConfig,
            ui: this.ui,
            localJupyter: forLocal
        };
    }
}
