// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { JupyterSessionManager } from './jupyterSessionManager';
import { IAsyncDisposableRegistry, IConfigurationService } from '../../../platform/common/types';
import { IJupyterConnection } from '../../types';
import {
    IJupyterSessionManagerFactory,
    IJupyterSessionManager,
    IJupyterBackingFileCreator,
    IJupyterKernelService,
    IJupyterRequestCreator
} from '../types';
import { JupyterConnection } from '../connection/jupyterConnection';
import { IServiceContainer } from '../../../platform/ioc/types';

@injectable()
export class JupyterSessionManagerFactory implements IJupyterSessionManagerFactory {
    constructor(
        @inject(IConfigurationService) private config: IConfigurationService,
        @inject(IJupyterKernelService) @optional() private readonly kernelService: IJupyterKernelService | undefined,
        @inject(IJupyterBackingFileCreator) private readonly backingFileCreator: IJupyterBackingFileCreator,
        @inject(IJupyterRequestCreator) private readonly requestCreator: IJupyterRequestCreator,
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer
    ) {}

    /**
     * Creates a new IJupyterSessionManager.
     * @param connInfo - connection information to the server that's already running.
     * @param failOnPassword - whether or not to fail the creation if a password is required.
     */
    public async create(connInfo: IJupyterConnection): Promise<IJupyterSessionManager> {
        const result = new JupyterSessionManager(
            this.config,
            this.config,
            this.kernelService,
            this.backingFileCreator,
            this.requestCreator,
            this.serviceContainer.get<JupyterConnection>(JupyterConnection)
        );
        this.asyncDisposables.push(result);
        await result.initialize(connInfo);
        return result;
    }
}
