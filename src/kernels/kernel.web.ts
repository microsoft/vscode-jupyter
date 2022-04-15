// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { NotebookCell, NotebookController, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../platform/common/application/types';
import { Resource, IDisposableRegistry, IConfigurationService } from '../platform/common/types';
import { CellHashProviderFactory } from '../interactive-window/editor-integration/cellHashProviderFactory';
import { INotebookProvider, KernelConnectionMetadata, NotebookCellRunState } from './types';
import { BaseKernel } from './kernel.base';

/**
 * This class is just a stand in for now. It will connect to kernels in the web when this is finished.
 * For now it's just here to get the service container to load.
 */
export class Kernel extends BaseKernel {
    constructor(
        id: Uri,
        resourceUri: Resource,
        kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        notebookProvider: INotebookProvider,
        disposables: IDisposableRegistry,
        launchTimeout: number,
        appShell: IApplicationShell,
        controller: NotebookController,
        configService: IConfigurationService,
        cellHashProviderFactory: CellHashProviderFactory,
        workspaceService: IWorkspaceService
    ) {
        super(
            id,
            resourceUri,
            kernelConnectionMetadata,
            notebookProvider,
            disposables,
            launchTimeout,
            appShell,
            controller,
            configService,
            workspaceService,
            cellHashProviderFactory
        );
    }

    public get pendingCells(): readonly NotebookCell[] {
        return [];
    }
    public async executeCell(_cell: NotebookCell): Promise<NotebookCellRunState> {
        // Not supported yet.
        return NotebookCellRunState.Error;
    }
    public async interrupt(): Promise<void> {
        // Does nothing
    }
    public async dispose(): Promise<void> {
        // Does nothing
    }
    public async restart(): Promise<void> {
        // Does nothing
    }

    protected async getDebugCellHook(): Promise<string[]> {
        // Not supported yet
        return [];
    }

    protected async getUpdateWorkingDirectoryAndPathCode(_launchingFile?: Resource): Promise<string[]> {
        // Not supported on web
        return [];
    }

    protected override async sendTelemetryForPythonKernelExecutable() {
        // Does nothing at the moment
    }
}
