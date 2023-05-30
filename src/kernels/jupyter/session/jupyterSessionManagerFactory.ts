// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { JupyterSessionManager } from './jupyterSessionManager';
import { IAsyncDisposableRegistry, IConfigurationService } from '../../../platform/common/types';
import { IJupyterConnection } from '../../types';
import {
    IJupyterSessionManagerFactory,
    IJupyterSessionManager,
    IJupyterKernelService,
    IJupyterRequestCreator
} from '../types';
import type { ServerConnection } from '@jupyterlab/services';

@injectable()
export class JupyterSessionManagerFactory implements IJupyterSessionManagerFactory {
    constructor(
        @inject(IConfigurationService) private config: IConfigurationService,
        @inject(IJupyterKernelService) @optional() private readonly kernelService: IJupyterKernelService | undefined,
        @inject(IJupyterRequestCreator)
        private readonly requestCreator: IJupyterRequestCreator,
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry
    ) {}

    public create(connection: IJupyterConnection, settings: ServerConnection.ISettings): IJupyterSessionManager {
        const result = new JupyterSessionManager(
            this.config,
            this.kernelService,
            this.requestCreator,
            connection,
            settings
        );
        this.asyncDisposables.push(result);
        return result;
    }
}
