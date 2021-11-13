// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { DisplayOptions } from '../displayOptions';
import { SessionDisposedError } from '../errors/sessionDisposedError';
import {
    ConnectNotebookProviderOptions,
    NotebookCreationOptions,
    IJupyterConnection,
    IJupyterNotebookProvider,
    IJupyterServerProvider,
    INotebook
} from '../types';

// When the NotebookProvider looks to create a notebook it uses this class to create a Jupyter notebook
@injectable()
export class JupyterNotebookProvider implements IJupyterNotebookProvider {
    constructor(@inject(IJupyterServerProvider) private readonly serverProvider: IJupyterServerProvider) {}

    public async disconnect(options: ConnectNotebookProviderOptions): Promise<void> {
        const ui = new DisplayOptions(options.disableUI === true);
        try {
            const server = await this.serverProvider.getOrCreateServer({
                getOnly: false,
                ui,
                resource: options.resource,
                token: options.token
            });
            return server?.dispose();
        } finally {
            ui.dispose();
        }
    }

    public async connect(options: ConnectNotebookProviderOptions): Promise<IJupyterConnection | undefined> {
        const ui = new DisplayOptions(options.disableUI === true);
        try {
            const server = await this.serverProvider.getOrCreateServer({
                getOnly: false,
                ui: new DisplayOptions(options.disableUI === true),
                resource: options.resource,
                token: options.token
            });
            return server?.getConnectionInfo();
        } finally {
            ui.dispose();
        }
    }

    public async createNotebook(options: NotebookCreationOptions): Promise<INotebook> {
        // Make sure we have a server
        const server = await this.serverProvider.getOrCreateServer({
            getOnly: false,
            ui: options.ui,
            resource: options.resource,
            token: options.token
        });

        if (server) {
            return server.createNotebook(options.resource, options.kernelConnection, options.token);
        }
        // We want createNotebook to always return a notebook promise, so if we don't have a server
        // here throw our generic server disposed message that we use in server creatio n
        throw new SessionDisposedError();
    }
}
