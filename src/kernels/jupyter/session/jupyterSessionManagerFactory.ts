// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { JupyterSessionManager } from './jupyterSessionManager';
import { IAsyncDisposableRegistry } from '../../../platform/common/types';
import { IJupyterConnection } from '../../types';
import { IJupyterSessionManagerFactory, IJupyterSessionManager } from '../types';
import { JupyterConnection } from '../connection/jupyterConnection';
import { IServiceContainer } from '../../../platform/ioc/types';

@injectable()
export class JupyterSessionManagerFactory implements IJupyterSessionManagerFactory {
    constructor(
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer
    ) {}

    /**
     * Creates a new IJupyterSessionManager.
     * @param connInfo - connection information to the server that's already running.
     * @param failOnPassword - whether or not to fail the creation if a password is required.
     */
    public async create(connInfo: IJupyterConnection): Promise<IJupyterSessionManager> {
        const serverSettings = await this.serviceContainer
            .get<JupyterConnection>(JupyterConnection)
            .getServerConnectSettings(connInfo);

        const result = new JupyterSessionManager(connInfo, serverSettings);
        this.asyncDisposables.push(result);
        return result;
    }
}
