// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ConnectNotebookProviderOptions, IJupyterConnection } from '../../types';
import { IJupyterNotebookProvider, IJupyterServerProvider } from '../types';

// When the NotebookProvider looks to create a notebook it uses this class to create a Jupyter notebook
@injectable()
export class JupyterNotebookProvider implements IJupyterNotebookProvider {
    constructor(@inject(IJupyterServerProvider) private readonly serverProvider: IJupyterServerProvider) {}

    public async startJupyter(options: ConnectNotebookProviderOptions): Promise<IJupyterConnection> {
        return this.serverProvider.getOrCreateServer(options);
    }
}
