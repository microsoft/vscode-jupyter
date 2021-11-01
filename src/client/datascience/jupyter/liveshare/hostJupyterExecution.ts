// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import * as uuid from 'uuid/v4';
import { CancellationToken } from 'vscode';

import { IApplicationShell, IWorkspaceService } from '../../../common/application/types';
import { traceInfo } from '../../../common/logger';

import { IFileSystem } from '../../../common/platform/types';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IOutputChannel
} from '../../../common/types';
import { IInterpreterService } from '../../../interpreter/contracts';
import { IServiceContainer } from '../../../ioc/types';
import { IJupyterExecution, INotebookServer, INotebookServerOptions } from '../../types';
import { JupyterExecutionBase } from '../jupyterExecution';
import { NotebookStarter } from '../notebookStarter';
import { ServerCache } from './serverCache';
import { inject, injectable, named } from 'inversify';
import { STANDARD_OUTPUT_CHANNEL } from '../../../common/constants';

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
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) jupyterOutputChannel: IOutputChannel,
        @inject(IServiceContainer) serviceContainer: IServiceContainer
    ) {
        super(
            interpreterService,
            disposableRegistry,
            workspace,
            configService,
            notebookStarter,
            appShell,
            jupyterOutputChannel,
            serviceContainer
        );
        this.serverCache = new ServerCache(configService, workspace, fs);
        asyncRegistry.push(this);
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
        options?: INotebookServerOptions,
        cancelToken?: CancellationToken
    ): Promise<INotebookServer | undefined> {
        if (!this._disposed) {
            return super.connectToNotebookServer(await this.serverCache.generateDefaultOptions(options), cancelToken);
        }
    }

    public async connectToNotebookServer(
        options?: INotebookServerOptions,
        cancelToken?: CancellationToken
    ): Promise<INotebookServer | undefined> {
        if (!this._disposed) {
            return this.serverCache.getOrCreate(this.hostConnectToNotebookServer.bind(this), options, cancelToken);
        }
    }
    public async getServer(options?: INotebookServerOptions): Promise<INotebookServer | undefined> {
        if (!this._disposed) {
            // See if we have this server or not.
            return this.serverCache.get(options);
        }
    }
}
