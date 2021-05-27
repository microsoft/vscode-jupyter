// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import { CancellationToken, Event, EventEmitter } from 'vscode';

import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../../common/constants';

import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IOutputChannel
} from '../../common/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { IJupyterExecution, INotebookServer, INotebookServerOptions } from '../types';
import { JupyterExecutionBase } from './jupyterExecution';
import { KernelSelector } from './kernels/kernelSelector';
import { NotebookStarter } from './notebookStarter';

interface IJupyterExecutionInterface extends IJupyterExecution {}

@injectable()
export class JupyterExecutionFactory implements IJupyterExecution {
    private executionFactory: IJupyterExecutionInterface;
    private serverStartedEventEmitter: EventEmitter<INotebookServerOptions | undefined> = new EventEmitter<
        INotebookServerOptions | undefined
    >();

    constructor(
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IWorkspaceService) workspace: IWorkspaceService,
        @inject(IConfigurationService) configuration: IConfigurationService,
        @inject(KernelSelector) kernelSelector: KernelSelector,
        @inject(NotebookStarter) notebookStarter: NotebookStarter,
        @inject(IApplicationShell) appShell: IApplicationShell,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) jupyterOutputChannel: IOutputChannel,
        @inject(IServiceContainer) serviceContainer: IServiceContainer
    ) {
        asyncRegistry.push(this);
        this.executionFactory = new JupyterExecutionBase(
            interpreterService,
            disposableRegistry,
            workspace,
            configuration,
            kernelSelector,
            notebookStarter,
            appShell,
            jupyterOutputChannel,
            serviceContainer
        );
    }

    public get serverStarted(): Event<INotebookServerOptions | undefined> {
        return this.serverStartedEventEmitter.event;
    }

    public async dispose(): Promise<void> {
        // Dispose of our execution object
        return this.executionFactory.dispose();
    }

    public async refreshCommands(): Promise<void> {
        return this.executionFactory.refreshCommands();
    }

    public async isNotebookSupported(cancelToken?: CancellationToken): Promise<boolean> {
        return this.executionFactory.isNotebookSupported(cancelToken);
    }

    public async getNotebookError(): Promise<string> {
        return this.executionFactory.getNotebookError();
    }

    public async isSpawnSupported(cancelToken?: CancellationToken): Promise<boolean> {
        return this.executionFactory.isSpawnSupported(cancelToken);
    }
    public async connectToNotebookServer(
        options?: INotebookServerOptions,
        cancelToken?: CancellationToken
    ): Promise<INotebookServer | undefined> {
        const server = await this.executionFactory.connectToNotebookServer(options, cancelToken);
        if (server) {
            this.serverStartedEventEmitter.fire(options);
        }
        return server;
    }
    public async spawnNotebook(file: string): Promise<void> {
        return this.executionFactory.spawnNotebook(file);
    }
    public async getUsableJupyterPython(cancelToken?: CancellationToken): Promise<PythonEnvironment | undefined> {
        return this.executionFactory.getUsableJupyterPython(cancelToken);
    }
    public async getServer(options?: INotebookServerOptions): Promise<INotebookServer | undefined> {
        return this.executionFactory.getServer(options);
    }
}
