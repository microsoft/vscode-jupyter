// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named, optional } from 'inversify';
import { JupyterSessionManager } from './jupyterSessionManager';
import { JUPYTER_OUTPUT_CHANNEL } from '../../../platform/common/constants';
import { IAsyncDisposableRegistry, IConfigurationService, IOutputChannel } from '../../../platform/common/types';
import { IJupyterConnection } from '../../types';
import {
    IJupyterSessionManagerFactory,
    IJupyterSessionManager,
    IJupyterBackingFileCreator,
    IJupyterKernelService,
    IJupyterRequestCreator
} from '../types';
import type { ServerConnection } from '@jupyterlab/services';

@injectable()
export class JupyterSessionManagerFactory implements IJupyterSessionManagerFactory {
    constructor(
        @inject(IConfigurationService) private config: IConfigurationService,
        @inject(IOutputChannel) @named(JUPYTER_OUTPUT_CHANNEL) private jupyterOutput: IOutputChannel,
        @inject(IJupyterKernelService) @optional() private readonly kernelService: IJupyterKernelService | undefined,
        @inject(IJupyterBackingFileCreator) private readonly backingFileCreator: IJupyterBackingFileCreator,
        @inject(IJupyterRequestCreator)
        private readonly requestCreator: IJupyterRequestCreator,
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry
    ) {}

    public create(connection: IJupyterConnection, settings: ServerConnection.ISettings): IJupyterSessionManager {
        const result = new JupyterSessionManager(
            this.jupyterOutput,
            this.config,
            this.kernelService,
            this.backingFileCreator,
            this.requestCreator,
            connection,
            settings
        );
        this.asyncDisposables.push(result);
        return result;
    }
}
