// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import '../../../../platform/common/extensions';

import uuid from 'uuid/v4';
import { CancellationToken } from 'vscode';

import { JupyterExecutionBase } from '../jupyterExecution';
import { ServerCache } from './serverCache';
import { inject, injectable, optional } from 'inversify';
import { IWorkspaceService } from '../../../../platform/common/application/types';
import { traceInfo } from '../../../../platform/logging';
import {
    IDisposableRegistry,
    IAsyncDisposableRegistry,
    IConfigurationService
} from '../../../../platform/common/types';
import { testOnlyMethod } from '../../../../platform/common/utils/decorators';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';
import {
    IJupyterExecution,
    INotebookServerOptions,
    INotebookServer,
    INotebookStarter,
    INotebookServerFactory,
    IJupyterServerUriStorage
} from '../../types';
import { IJupyterSubCommandExecutionService } from '../../types.node';
import { JupyterConnection } from '../../jupyterConnection';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Jupyter server implementation that uses the JupyterExecutionBase class to launch Jupyter.
 */
@injectable()
export class HostJupyterExecution extends JupyterExecutionBase implements IJupyterExecution {
    private serverCache: ServerCache;
    private _disposed = false;
    private _id = uuid();
    constructor(
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IWorkspaceService) workspace: IWorkspaceService,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(INotebookStarter) @optional() notebookStarter: INotebookStarter | undefined,
        @inject(IJupyterSubCommandExecutionService)
        @optional()
        jupyterInterpreterService: IJupyterSubCommandExecutionService | undefined,
        @inject(INotebookServerFactory) notebookServerFactory: INotebookServerFactory,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterConnection) jupyterConnection: JupyterConnection
    ) {
        super(
            interpreterService,
            disposableRegistry,
            workspace,
            configService,
            notebookStarter,
            jupyterInterpreterService,
            notebookServerFactory,
            jupyterConnection
        );
        this.serverCache = new ServerCache();
        this.serverUriStorage.onDidChangeUri(
            () => {
                this.serverCache.clearCache();
            },
            this,
            disposableRegistry
        );
        asyncRegistry.push(this);
    }

    @testOnlyMethod()
    public clearCache() {
        this.serverCache.clearCache();
    }
    public override async dispose(): Promise<void> {
        traceInfo(`Disposing HostJupyterExecution ${this._id}`);
        if (!this._disposed) {
            this._disposed = true;
            traceInfo(`Disposing super HostJupyterExecution ${this._id}`);
            await super.dispose();

            // Cleanup on dispose. We are going away permanently
            if (this.serverCache) {
                traceInfo(`Cleaning up server cache ${this._id}`);
                await this.serverCache.dispose();
            }
        }
        traceInfo(`Finished disposing HostJupyterExecution  ${this._id}`);
    }

    private async hostConnectToNotebookServer(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer> {
        if (!this._disposed) {
            return super.connectToNotebookServer(await this.serverCache.generateDefaultOptions(options), cancelToken);
        }
        throw new Error('Notebook server is disposed');
    }

    public override async connectToNotebookServer(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer> {
        if (!this._disposed) {
            return this.serverCache.getOrCreate(this.hostConnectToNotebookServer.bind(this), options, cancelToken);
        }
        throw new Error('Notebook server is disposed');
    }
    public override async getServer(options: INotebookServerOptions): Promise<INotebookServer | undefined> {
        if (!this._disposed) {
            // See if we have this server or not.
            return this.serverCache.get(options);
        }
    }
}
