// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';

import type { Kernel } from '@jupyterlab/services';
import { EventEmitter } from 'vscode';
import { IConfigurationService, IDisposableRegistry, IOutputChannel } from '../../common/types';
import { RemoteJupyterConnectionsService } from '../../remote/connection/remoteConnectionsService';
import { JUPYTER_OUTPUT_CHANNEL } from '../constants';
import { IJupyterConnection, IJupyterSessionManager, IJupyterSessionManagerFactory } from '../types';
import { JupyterSessionManager } from './jupyterSessionManager';

@injectable()
export class JupyterSessionManagerFactory implements IJupyterSessionManagerFactory {
    private restartSessionCreatedEvent = new EventEmitter<Kernel.IKernelConnection>();
    private restartSessionUsedEvent = new EventEmitter<Kernel.IKernelConnection>();
    constructor(
        @inject(IConfigurationService) private config: IConfigurationService,
        @inject(IOutputChannel) @named(JUPYTER_OUTPUT_CHANNEL) private jupyterOutput: IOutputChannel,
        @inject(RemoteJupyterConnectionsService) private readonly remoteConnections: RemoteJupyterConnectionsService,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry
    ) {}

    /**
     * Creates a new IJupyterSessionManager.
     * @param connInfo - connection information to the server that's already running.
     * @param failOnPassword - whether or not to fail the creation if a password is required.
     */
    public async create(connInfo: IJupyterConnection, failOnPassword?: boolean): Promise<IJupyterSessionManager> {
        const serverSettings = await this.remoteConnections.getServerConnectSettings(connInfo, failOnPassword);

        const result = new JupyterSessionManager(connInfo, serverSettings, this.jupyterOutput, this.config);
        this.disposableRegistry.push(
            result.onRestartSessionCreated(this.restartSessionCreatedEvent.fire.bind(this.restartSessionCreatedEvent))
        );
        this.disposableRegistry.push(
            result.onRestartSessionUsed(this.restartSessionUsedEvent.fire.bind(this.restartSessionUsedEvent))
        );
        return result;
    }

    public get onRestartSessionCreated() {
        return this.restartSessionCreatedEvent.event;
    }

    public get onRestartSessionUsed() {
        return this.restartSessionUsedEvent.event;
    }
}
