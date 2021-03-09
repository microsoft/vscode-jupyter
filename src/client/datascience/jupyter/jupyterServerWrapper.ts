// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable, named } from 'inversify';
import * as uuid from 'uuid/v4';
import { Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import * as vsls from 'vsls/vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { IApplicationShell, ILiveShareApi, IVSCodeNotebook, IWorkspaceService } from '../../common/application/types';
import '../../common/extensions';
import { IFileSystem } from '../../common/platform/types';

import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IOutputChannel,
    Resource
} from '../../common/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { DataScienceStartupTime, JUPYTER_OUTPUT_CHANNEL } from '../constants';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { ProgressReporter } from '../progress/progressReporter';
import {
    IJupyterConnection,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookServer,
    INotebookServerLaunchInfo
} from '../types';
import { KernelConnectionMetadata } from './kernels/types';
import { GuestJupyterServer } from './liveshare/guestJupyterServer';
import { HostJupyterServer } from './liveshare/hostJupyterServer';
import { IRoleBasedObject, RoleBasedFactory } from './liveshare/roleBasedFactory';
import { ILiveShareHasRole } from './liveshare/types';

interface IJupyterServerInterface extends IRoleBasedObject, INotebookServer {}

/* eslint-disable @typescript-eslint/prefer-function-type */
type JupyterServerClassType = {
    new (
        liveShare: ILiveShareApi,
        startupTime: number,
        asyncRegistry: IAsyncDisposableRegistry,
        disposableRegistry: IDisposableRegistry,
        configService: IConfigurationService,
        sessionManager: IJupyterSessionManagerFactory,
        workspaceService: IWorkspaceService,
        serviceContainer: IServiceContainer,
        appShell: IApplicationShell,
        fs: IFileSystem,
        localKernelFinder: ILocalKernelFinder,
        remoteKernelFinder: IRemoteKernelFinder,
        interpreterService: IInterpreterService,
        outputChannel: IOutputChannel,
        progressReporter: ProgressReporter,
        extensionChecker: IPythonExtensionChecker,
        vscodeNotebook: IVSCodeNotebook
    ): IJupyterServerInterface;
};
/* eslint-enable @typescript-eslint/prefer-function-type */

// This class wraps either a HostJupyterServer or a GuestJupyterServer based on the liveshare state. It abstracts
// out the live share specific parts.
@injectable()
export class JupyterServerWrapper implements INotebookServer, ILiveShareHasRole {
    private serverFactory: RoleBasedFactory<IJupyterServerInterface, JupyterServerClassType>;

    private launchInfo: INotebookServerLaunchInfo | undefined;
    private _id: string = uuid();

    constructor(
        @inject(ILiveShareApi) liveShare: ILiveShareApi,
        @inject(DataScienceStartupTime) startupTime: number,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(IJupyterSessionManagerFactory) sessionManager: IJupyterSessionManagerFactory,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(ILocalKernelFinder) localKernelFinder: ILocalKernelFinder,
        @inject(IRemoteKernelFinder) remoteKernelFinder: IRemoteKernelFinder,
        @inject(IOutputChannel) @named(JUPYTER_OUTPUT_CHANNEL) jupyterOutput: IOutputChannel,
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(ProgressReporter) progressReporter: ProgressReporter,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IVSCodeNotebook) vscodeNotebook: IVSCodeNotebook
    ) {
        // The server factory will create the appropriate HostJupyterServer or GuestJupyterServer based on
        // the liveshare state.
        this.serverFactory = new RoleBasedFactory<IJupyterServerInterface, JupyterServerClassType>(
            liveShare,
            HostJupyterServer,
            GuestJupyterServer,
            liveShare,
            startupTime,
            asyncRegistry,
            disposableRegistry,
            configService,
            sessionManager,
            workspaceService,
            serviceContainer,
            appShell,
            fs,
            localKernelFinder,
            remoteKernelFinder,
            interpreterService,
            jupyterOutput,
            progressReporter,
            extensionChecker,
            vscodeNotebook
        );
    }

    public get role(): vsls.Role {
        return this.serverFactory.role;
    }

    public get id(): string {
        return this._id;
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, cancelToken?: CancellationToken): Promise<void> {
        this.launchInfo = launchInfo;
        const server = await this.serverFactory.get();
        return server.connect(launchInfo, cancelToken);
    }

    public async createNotebook(
        resource: Resource,
        identity: Uri,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        const server = await this.serverFactory.get();
        return server.createNotebook(resource, identity, notebookMetadata, kernelConnection, cancelToken);
    }

    public async shutdown(): Promise<void> {
        const server = await this.serverFactory.get();
        return server.shutdown();
    }

    public async dispose(): Promise<void> {
        const server = await this.serverFactory.get();
        return server.dispose();
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IJupyterConnection | undefined {
        if (this.launchInfo) {
            return this.launchInfo.connectionInfo;
        }
        return undefined;
    }

    public async getNotebook(resource: Uri, token?: CancellationToken): Promise<INotebook | undefined> {
        const server = await this.serverFactory.get();
        return server.getNotebook(resource, token);
    }

    public async waitForConnect(): Promise<INotebookServerLaunchInfo | undefined> {
        const server = await this.serverFactory.get();
        return server.waitForConnect();
    }
}
