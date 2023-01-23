// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    ConnectNotebookProviderOptions,
    GetServerOptions,
    IJupyterConnection,
    IKernelConnectionSession,
    isLocalConnection,
    NotebookCreationOptions
} from '../../types';
import { Cancellation } from '../../../platform/common/cancellation';
import { IJupyterNotebookProvider, IJupyterServerProvider } from '../types';

// When the NotebookProvider looks to create a notebook it uses this class to create a Jupyter notebook
@injectable()
export class JupyterNotebookProvider implements IJupyterNotebookProvider {
    constructor(@inject(IJupyterServerProvider) private readonly serverProvider: IJupyterServerProvider) {}

    public async connect(options: ConnectNotebookProviderOptions): Promise<IJupyterConnection> {
        const { connection } = await this.serverProvider.getOrCreateServer(options);
        return connection;
    }

    public async createNotebook(options: NotebookCreationOptions): Promise<IKernelConnectionSession> {
        const kernelConnection = options.kernelConnection;
        // Make sure we have a server
        const serverOptions: GetServerOptions = isLocalConnection(kernelConnection)
            ? {
                  ui: options.ui,
                  resource: options.resource,
                  token: options.token,
                  localJupyter: true
              }
            : {
                  ui: options.ui,
                  resource: options.resource,
                  token: options.token,
                  localJupyter: false,
                  serverId: kernelConnection.serverId
              };
        const server = await this.serverProvider.getOrCreateServer(serverOptions);
        Cancellation.throwIfCanceled(options.token);
        return server.createNotebook(
            options.resource,
            options.kernelConnection,
            options.token,
            options.ui,
            options.creator
        );
    }
}
