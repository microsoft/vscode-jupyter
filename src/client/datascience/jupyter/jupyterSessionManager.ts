// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { Kernel } from '@jupyterlab/services';
import { EventEmitter } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { IApplicationShell } from '../../common/application/types';

import { IConfigurationService, IOutputChannel, IPersistentStateFactory } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { IJupyterConnection, IJupyterPasswordConnect, IJupyterSession, IJupyterSessionManager } from '../types';
import { JupyterConnectionManager } from './jupyterConnectionManager';
import { JupyterSession } from './jupyterSession';
import { KernelConnectionMetadata } from './kernels/types';

// Key for our insecure connection global state

// tslint:disable: no-any

export class JupyterSessionManager extends JupyterConnectionManager implements IJupyterSessionManager {
    private restartSessionCreatedEvent = new EventEmitter<Kernel.IKernelConnection>();
    private restartSessionUsedEvent = new EventEmitter<Kernel.IKernelConnection>();
    constructor(
        jupyterPasswordConnect: IJupyterPasswordConnect,
        config: IConfigurationService,
        failOnPassword: boolean | undefined,
        outputChannel: IOutputChannel,
        configService: IConfigurationService,
        readonly appShell: IApplicationShell,
        readonly stateFactory: IPersistentStateFactory
    ) {
        super(jupyterPasswordConnect, config, failOnPassword, outputChannel, configService, appShell, stateFactory);
    }

    public get onRestartSessionCreated() {
        return this.restartSessionCreatedEvent.event;
    }

    public get onRestartSessionUsed() {
        return this.restartSessionUsedEvent.event;
    }

    public getConnInfo(): IJupyterConnection {
        return this.connInfo!;
    }

    public async initialize(connInfo: IJupyterConnection): Promise<void> {
        this.connInfo = connInfo;
        this.serverSettings = await this.getServerConnectSettings(connInfo);
        this.sessionManager = new this.jupyterlab.SessionManager({ serverSettings: this.serverSettings });
        this.contentsManager = new this.jupyterlab.ContentsManager({ serverSettings: this.serverSettings });
    }

    public async startNew(
        kernelConnection: KernelConnectionMetadata | undefined,
        workingDirectory: string,
        cancelToken?: CancellationToken
    ): Promise<IJupyterSession> {
        if (!this.connInfo || !this.sessionManager || !this.contentsManager || !this.serverSettings) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        // Create a new session and attempt to connect to it
        const session = new JupyterSession(
            this.connInfo,
            this.serverSettings,
            kernelConnection,
            this.sessionManager,
            this.contentsManager,
            this.outputChannel,
            this.restartSessionCreatedEvent.fire.bind(this.restartSessionCreatedEvent),
            this.restartSessionUsedEvent.fire.bind(this.restartSessionUsedEvent),
            workingDirectory,
            this.configService.getSettings().jupyterLaunchTimeout
        );
        try {
            await session.connect(this.configService.getSettings().jupyterLaunchTimeout, cancelToken);
        } finally {
            if (!session.isConnected) {
                await session.dispose();
            }
        }
        return session;
    }
}
