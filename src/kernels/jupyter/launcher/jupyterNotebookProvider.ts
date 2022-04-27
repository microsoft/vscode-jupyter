// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import {
    ConnectNotebookProviderOptions,
    IJupyterConnection,
    INotebook,
    isLocalConnection,
    NotebookCreationOptions
} from '../../types';
import { Cancellation } from '../../../platform/common/cancellation';
import { IJupyterNotebookProvider, IJupyterServerProvider, IJupyterServerUriStorage } from '../types';

// When the NotebookProvider looks to create a notebook it uses this class to create a Jupyter notebook
@injectable()
export class JupyterNotebookProvider implements IJupyterNotebookProvider {
    constructor(
        @inject(IJupyterServerProvider) private readonly serverProvider: IJupyterServerProvider,
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage
    ) {}

    public async connect(options: ConnectNotebookProviderOptions): Promise<IJupyterConnection> {
        const server = await this.serverProvider.getOrCreateServer({
            ui: options.ui,
            resource: options.resource,
            token: options.token,
            localJupyter: options.kind === 'localJupyter'
        });
        const connection = await server.connection;
        if (options.kind === 'remoteJupyter') {
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
            token: options.token,
            localJupyter: isLocalConnection(options.kernelConnection)
        });
        Cancellation.throwIfCanceled(options.token);
        if (server) {
            return server.createNotebook(
                options.resource,
                options.kernelConnection,
                options.token,
                options.ui,
                options.creator
            );
        }
        // We want createNotebook to always return a notebook promise, so if we don't have a server
        // here throw our generic server disposed message that we use in server creatio n
        throw new SessionDisposedError();
    }
}
