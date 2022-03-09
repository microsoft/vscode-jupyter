// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../../client/common/extensions';

import * as uuid from 'uuid/v4';
import { CancellationToken } from 'vscode';

import { JupyterExecutionBase } from '../jupyterExecution';
import { NotebookStarter } from '../notebookStarter';
import { ServerCache } from './serverCache';
import { inject, injectable } from 'inversify';
import { IWorkspaceService } from '../../../../client/common/application/types';
import { traceInfo } from '../../../../client/common/logger';
import { IFileSystem } from '../../../../client/common/platform/types';
import { IDisposableRegistry, IAsyncDisposableRegistry, IConfigurationService } from '../../../../client/common/types';
import { testOnlyMethod } from '../../../../client/common/utils/decorators';
import { IJupyterExecution, INotebookServerOptions, INotebookServer } from '../../../../client/datascience/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { IServiceContainer } from '../../../../client/ioc/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

@injectable()
export class HostJupyterExecution extends JupyterExecutionBase implements IJupyterExecution {
    private serverCache: ServerCache;
    private _disposed = false;
    private _id = uuid();
    constructor(
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IWorkspaceService) workspace: IWorkspaceService,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(NotebookStarter) notebookStarter: NotebookStarter,
        @inject(IServiceContainer) serviceContainer: IServiceContainer
    ) {
        super(interpreterService, disposableRegistry, workspace, configService, notebookStarter, serviceContainer);
        this.serverCache = new ServerCache(configService, workspace, fs);
        asyncRegistry.push(this);
    }

    @testOnlyMethod()
    public clearCache() {
        this.serverCache.clearCache();
    }
    public async dispose(): Promise<void> {
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

    public async hostConnectToNotebookServer(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer | undefined> {
        if (!this._disposed) {
            return super.connectToNotebookServer(await this.serverCache.generateDefaultOptions(options), cancelToken);
        }
    }

    public async connectToNotebookServer(
        options: INotebookServerOptions,
        cancelToken: CancellationToken
    ): Promise<INotebookServer | undefined> {
        if (!this._disposed) {
            return this.serverCache.getOrCreate(this.hostConnectToNotebookServer.bind(this), options, cancelToken);
        }
    }
    public async getServer(options: INotebookServerOptions): Promise<INotebookServer | undefined> {
        if (!this._disposed) {
            // See if we have this server or not.
            return this.serverCache.get(options);
        }
    }
}
