// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable, named } from 'inversify';
import * as uuid from 'uuid/v4';
import { Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { STANDARD_OUTPUT_CHANNEL } from '../../common/constants';
import '../../common/extensions';

import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IOutputChannel,
    Resource
} from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import {
    IJupyterConnection,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookServer,
    INotebookServerLaunchInfo
} from '../types';
import { JupyterServerBase } from './jupyterServer';
import { KernelConnectionMetadata } from './kernels/types';

// This class wraps either a HostJupyterServer or a GuestJupyterServer based on the liveshare state. It abstracts
// out the live share specific parts.
@injectable()
export class JupyterServerWrapper implements INotebookServer {
    private serverFactory: JupyterServerBase;

    private launchInfo: INotebookServerLaunchInfo | undefined;
    private _id: string = uuid();

    constructor(
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(IJupyterSessionManagerFactory) sessionManager: IJupyterSessionManagerFactory,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) jupyterOutput: IOutputChannel,
        @inject(IServiceContainer) serviceContainer: IServiceContainer
    ) {
        // The server factory will create the appropriate HostJupyterServer or GuestJupyterServer based on
        // the liveshare state.
        this.serverFactory = new JupyterServerBase(
            asyncRegistry,
            disposableRegistry,
            configService,
            sessionManager,
            serviceContainer,
            jupyterOutput
        );
    }

    public get id(): string {
        return this._id;
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, cancelToken?: CancellationToken): Promise<void> {
        this.launchInfo = launchInfo;
        return this.serverFactory.connect(launchInfo, cancelToken);
    }

    public async createNotebook(
        resource: Resource,
        identity: Uri,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        return this.serverFactory.createNotebook(resource, identity, notebookMetadata, kernelConnection, cancelToken);
    }

    public async shutdown(): Promise<void> {
        return this.serverFactory.shutdown();
    }

    public async dispose(): Promise<void> {
        return this.serverFactory.dispose();
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IJupyterConnection | undefined {
        if (this.launchInfo) {
            return this.launchInfo.connectionInfo;
        }
        return undefined;
    }

    public async getNotebook(resource: Uri): Promise<INotebook | undefined> {
        return this.serverFactory.getNotebook(resource);
    }

    public async waitForConnect(): Promise<INotebookServerLaunchInfo | undefined> {
        return this.serverFactory.waitForConnect();
    }
}
