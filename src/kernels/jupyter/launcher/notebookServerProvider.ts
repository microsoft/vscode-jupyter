// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, optional } from 'inversify';
import { CancellationError, CancellationToken } from 'vscode';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { traceInfo } from '../../../platform/logging';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../../platform/common/types';
import { testOnlyMethod } from '../../../platform/common/utils/decorators';
import { DataScience } from '../../../platform/common/utils/localize';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { JupyterServerSelector } from '../serverSelector';
import { Settings } from '../../../platform/common/constants';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DisplayOptions } from '../../displayOptions';
import { GetServerOptions } from '../../types';
import {
    IJupyterServerProvider,
    INotebookServer,
    IJupyterExecution,
    IJupyterServerUriStorage,
    INotebookServerOptions
} from '../types';
import { NotSupportedInWebError } from '../../../platform/errors/notSupportedInWebError';
import { getFilePath } from '../../../platform/common/platform/fs-paths';

@injectable()
export class NotebookServerProvider implements IJupyterServerProvider {
    private serverPromise: {
        local?: Promise<INotebookServer>;
        remote?: Promise<INotebookServer>;
    } = {};
    private ui = new DisplayOptions(true);
    constructor(
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IJupyterExecution) @optional() private readonly jupyterExecution: IJupyterExecution | undefined,
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
    public async getOrCreateServer(options: GetServerOptions): Promise<INotebookServer> {
        const serverOptions = await this.getNotebookServerOptions(options.resource, options.localJupyter === true);

        // If we are just fetching or only want to create for local, see if exists
        if (options.localJupyter && this.jupyterExecution) {
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
        const property = options.localJupyter ? 'local' : 'remote';
        if (!this.serverPromise[property]) {
            // Start a server
            this.serverPromise[property] = this.startServer(options.resource, options.token, options.localJupyter);
        }
        try {
            const value = await this.serverPromise[property]!;
            // If we cancelled starting of the server, then don't cache the result.
            if (!value && options.token?.isCancellationRequested) {
                delete this.serverPromise[property];
            }
            return value;
        } catch (e) {
            // Don't cache the error
            this.serverPromise[property] = undefined;
            throw e;
        }
    }

    private async startServer(
        resource: Resource,
        token: CancellationToken | undefined,
        forLocal: boolean
    ): Promise<INotebookServer> {
        if (!this.jupyterExecution) {
            throw new NotSupportedInWebError();
        }
        const serverOptions = await this.getNotebookServerOptions(resource, forLocal);
        traceInfo(`Checking for server existence.`);

        const disposables: IDisposable[] = [];
        let progressReporter: IDisposable | undefined;
        const createProgressReporter = async () => {
            if (this.ui.disableUI || progressReporter) {
                return;
            }
            // Status depends upon if we're about to connect to existing server or not.
            progressReporter = (await this.jupyterExecution!.getServer(serverOptions))
                ? KernelProgressReporter.createProgressReporter(resource, DataScience.connectingToJupyter())
                : KernelProgressReporter.createProgressReporter(resource, DataScience.startingJupyter());
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
                    DataScience.jupyterNotSupported().format(await this.jupyterExecution.getNotebookError())
                );
            }
            // Then actually start the server
            traceInfo(`Starting notebook server.`);
            const result = await this.jupyterExecution.connectToNotebookServer(serverOptions, token);
            traceInfo(`Server started.`);
            return result;
        } catch (e) {
            disposeAllDisposables(disposables);
            // If user cancelled, then do nothing.
            if (token?.isCancellationRequested && e instanceof CancellationError) {
                throw e;
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
            if (options.localJupyter && this.jupyterExecution) {
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
                throw new Error(
                    DataScience.jupyterNotSupportedBecauseOfEnvironment().format(displayName, e.toString())
                );
            } else {
                throw new JupyterInstallError(
                    DataScience.jupyterNotSupported().format(
                        this.jupyterExecution ? await this.jupyterExecution.getNotebookError() : 'Error'
                    )
                );
            }
        }
    }

    private async getNotebookServerOptions(resource: Resource, forLocal: boolean): Promise<INotebookServerOptions> {
        // Since there's one server per session, don't use a resource to figure out these settings
        let serverURI: string | undefined = await this.serverUriStorage.getRemoteUri();
        const useDefaultConfig: boolean | undefined =
            this.configuration.getSettings(undefined).useDefaultConfigForJupyter;

        // For the local case pass in our URI as undefined, that way connect doesn't have to check the setting
        if (forLocal || !serverURI) {
            return {
                resource,
                skipUsingDefaultConfig: !useDefaultConfig,
                ui: this.ui,
                localJupyter: true
            };
        }
        // If the URI is 'remote' then the encrypted storage is not working. Ask user again for server URI
        if (serverURI === Settings.JupyterServerRemoteLaunch) {
            await this.serverSelector.selectJupyterURI(true);
            // Should have been saved
            serverURI = await this.serverUriStorage.getRemoteUri();

            if (!serverURI) {
                throw new Error('Remote Jupyter Server connection not provided');
            }
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
