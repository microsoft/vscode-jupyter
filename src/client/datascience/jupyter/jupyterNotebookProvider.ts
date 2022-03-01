// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { SessionDisposedError } from '../errors/sessionDisposedError';
import {
    ConnectNotebookProviderOptions,
    NotebookCreationOptions,
    IJupyterConnection,
    IJupyterNotebookProvider,
    IJupyterServerProvider,
    INotebook,
    IJupyterServerUriStorage
} from '../types';
import { isLocalConnection } from './kernels/types';

// When the NotebookProvider looks to create a notebook it uses this class to create a Jupyter notebook
@injectable()
export class JupyterNotebookProvider implements IJupyterNotebookProvider {
    constructor(
        @inject(IJupyterServerProvider) private readonly serverProvider: IJupyterServerProvider,
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage
    ) {}

    public async connect(options: ConnectNotebookProviderOptions): Promise<IJupyterConnection | undefined> {
        const server = await this.serverProvider.getOrCreateServer({
            ui: options.ui,
            resource: options.resource,
            tokenSource: options.tokenSource,
            localJupyter: options.kind === 'localJupyter'
        });
        const connection = await server?.getConnectionInfo();
        if (connection && options.kind === 'remoteJupyter') {
            // Log this remote URI into our MRU list
            void this.serverStorage.addToUriList(
                connection.url || connection.displayName,
                Date.now(),
                connection.displayName
            );
        }
        return connection;
    }

    public async createNotebook(options: NotebookCreationOptions): Promise<INotebook> {
        // Make sure we have a server
        const server = await this.serverProvider.getOrCreateServer({
            ui: options.ui,
            resource: options.resource,
            tokenSource: options.tokenSource,
            localJupyter: isLocalConnection(options.kernelConnection)
        });

        if (server) {
            return server.createNotebook(options.resource, options.kernelConnection, options.tokenSource, options.ui);
        }
        // We want createNotebook to always return a notebook promise, so if we don't have a server
        // here throw our generic server disposed message that we use in server creatio n
        throw new SessionDisposedError();
    }
}
