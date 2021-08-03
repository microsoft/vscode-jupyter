// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import * as uuid from 'uuid/v4';
import { CancellationToken } from 'vscode';

import { IApplicationShell, ILiveShareApi, IWorkspaceService } from '../../../common/application/types';
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
import { KernelSelector } from '../kernels/kernelSelector';
import { NotebookStarter } from '../notebookStarter';
import { IRoleBasedObject } from './roleBasedFactory';
import { ServerCache } from './serverCache';

/* eslint-disable @typescript-eslint/no-explicit-any */

// This class is really just a wrapper around a jupyter execution that also provides a shared live share service
export class HostJupyterExecution extends JupyterExecutionBase implements IRoleBasedObject, IJupyterExecution {
    private serverCache: ServerCache;
    private _disposed = false;
    private _id = uuid();
    constructor(
        liveShare: ILiveShareApi,
        interpreterService: IInterpreterService,
        disposableRegistry: IDisposableRegistry,
        asyncRegistry: IAsyncDisposableRegistry,
        fs: IFileSystem,
        workspace: IWorkspaceService,
        configService: IConfigurationService,
        kernelSelector: KernelSelector,
        notebookStarter: NotebookStarter,
        appShell: IApplicationShell,
        jupyterOutputChannel: IOutputChannel,
        serviceContainer: IServiceContainer
    ) {
        super(
            liveShare,
            interpreterService,
            disposableRegistry,
            workspace,
            configService,
            kernelSelector,
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
