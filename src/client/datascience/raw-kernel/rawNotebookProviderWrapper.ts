// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable, named } from 'inversify';
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
import { IServiceContainer } from '../../ioc/types';
import { DataScienceStartupTime, JUPYTER_OUTPUT_CHANNEL } from '../constants';
import { KernelSelector } from '../jupyter/kernels/kernelSelector';
import { KernelService } from '../jupyter/kernels/kernelService';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { IRoleBasedObject, RoleBasedFactory } from '../jupyter/liveshare/roleBasedFactory';
import { ILiveShareHasRole } from '../jupyter/liveshare/types';
import { IKernelLauncher } from '../kernel-launcher/types';
import { ProgressReporter } from '../progress/progressReporter';
import {
    ConnectNotebookProviderOptions,
    IKernelDependencyService,
    INotebook,
    IRawConnection,
    IRawNotebookProvider,
    IRawNotebookSupportedService
} from '../types';
import { GuestRawNotebookProvider } from './liveshare/guestRawNotebookProvider';
import { HostRawNotebookProvider } from './liveshare/hostRawNotebookProvider';

interface IRawNotebookProviderInterface extends IRoleBasedObject, IRawNotebookProvider {}

/* eslint-disable @typescript-eslint/prefer-function-type */
type RawNotebookProviderClassType = {
    new (
        liveShare: ILiveShareApi,
        startupTime: number,
        disposableRegistry: IDisposableRegistry,
        asyncRegistry: IAsyncDisposableRegistry,
        configService: IConfigurationService,
        workspaceService: IWorkspaceService,
        appShell: IApplicationShell,
        fs: IFileSystem,
        serviceContainer: IServiceContainer,
        kernelLauncher: IKernelLauncher,
        kernelSelector: KernelSelector,
        progressReporter: ProgressReporter,
        outputChannel: IOutputChannel,
        rawKernelSupported: IRawNotebookSupportedService,
        kernelDependencyService: IKernelDependencyService,
        kernelService: KernelService,
        extensionChecker: IPythonExtensionChecker,
        vscNotebook: IVSCodeNotebook
    ): IRawNotebookProviderInterface;
};
/* eslint-enable @typescript-eslint/prefer-function-type */

// This class wraps either a HostRawNotebookProvider or a GuestRawNotebookProvider based on the liveshare state. It abstracts
// out the live share specific parts.
@injectable()
export class RawNotebookProviderWrapper implements IRawNotebookProvider, ILiveShareHasRole {
    private serverFactory: RoleBasedFactory<IRawNotebookProviderInterface, RawNotebookProviderClassType>;

    constructor(
        @inject(ILiveShareApi) liveShare: ILiveShareApi,
        @inject(DataScienceStartupTime) startupTime: number,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IKernelLauncher) kernelLauncher: IKernelLauncher,
        @inject(KernelSelector) kernelSelector: KernelSelector,
        @inject(ProgressReporter) progressReporter: ProgressReporter,
        @inject(IOutputChannel) @named(JUPYTER_OUTPUT_CHANNEL) outputChannel: IOutputChannel,
        @inject(IRawNotebookSupportedService) rawNotebookSupported: IRawNotebookSupportedService,
        @inject(IKernelDependencyService) kernelDependencyService: IKernelDependencyService,
        @inject(KernelService) kernelService: KernelService,
        @inject(IPythonExtensionChecker) extensionChecker: IPythonExtensionChecker,
        @inject(IVSCodeNotebook) vscNotebook: IVSCodeNotebook
    ) {
        // The server factory will create the appropriate HostRawNotebookProvider or GuestRawNotebookProvider based on
        // the liveshare state.
        this.serverFactory = new RoleBasedFactory<IRawNotebookProviderInterface, RawNotebookProviderClassType>(
            liveShare,
            HostRawNotebookProvider,
            GuestRawNotebookProvider,
            liveShare,
            startupTime,
            disposableRegistry,
            asyncRegistry,
            configService,
            workspaceService,
            appShell,
            fs,
            serviceContainer,
            kernelLauncher,
            kernelSelector,
            progressReporter,
            outputChannel,
            rawNotebookSupported,
            kernelDependencyService,
            kernelService,
            extensionChecker,
            vscNotebook
        );
    }

    public get role(): vsls.Role {
        return this.serverFactory.role;
    }

    public async supported(): Promise<boolean> {
        const notebookProvider = await this.serverFactory.get();
        return notebookProvider.supported();
    }

    public async connect(options: ConnectNotebookProviderOptions): Promise<IRawConnection | undefined> {
        const notebookProvider = await this.serverFactory.get();
        return notebookProvider.connect(options);
    }

    public async createNotebook(
        identity: Uri,
        resource: Resource,
        disableUI: boolean,
        notebookMetadata: nbformat.INotebookMetadata,
        kernelConnection: KernelConnectionMetadata,
        cancelToken: CancellationToken
    ): Promise<INotebook> {
        const notebookProvider = await this.serverFactory.get();
        return notebookProvider.createNotebook(
            identity,
            resource,
            disableUI,
            notebookMetadata,
            kernelConnection,
            cancelToken
        );
    }

    public async getNotebook(identity: Uri): Promise<INotebook | undefined> {
        const notebookProvider = await this.serverFactory.get();
        return notebookProvider.getNotebook(identity);
    }

    public async dispose(): Promise<void> {
        const server = await this.serverFactory.get();
        return server.dispose();
    }
}
