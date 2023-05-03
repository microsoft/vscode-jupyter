// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    ConnectNotebookProviderOptions,
    GetServerOptions,
    IJupyterConnection,
    IKernelConnectionSession,
    KernelConnectionSessionCreationOptions
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

    public async createNotebook(options: KernelConnectionSessionCreationOptions): Promise<IKernelConnectionSession> {
        // Make sure we have a server
        const serverOptions: GetServerOptions = {
            ui: options.ui,
            resource: options.resource,
            token: options.token
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
