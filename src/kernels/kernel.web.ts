// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { NotebookController, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../platform/common/application/types';
import { Resource, IConfigurationService, IExtensionContext } from '../platform/common/types';
import { INotebookProvider, ITracebackFormatter, KernelActionSource, KernelConnectionMetadata } from './types';
import { BaseKernel } from './kernel.base';
import { IStatusProvider } from '../platform/progress/types';
import { InteractiveWindowView } from '../platform/common/constants';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { getAssociatedNotebookDocument } from './helpers';
const addRunCellHook = require('../../pythonFiles/vscode_datascience_helpers/kernel/addRunCellHook.py');

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
        launchTimeout: number,
        interruptTimeout: number,
        appShell: IApplicationShell,
        controller: NotebookController,
        configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        workspaceService: IWorkspaceService,
        statusProvider: IStatusProvider,
        creator: KernelActionSource,
        context: IExtensionContext,
        formatters: ITracebackFormatter[]
    ) {
        super(
            id,
            resourceUri,
            kernelConnectionMetadata,
            notebookProvider,
            launchTimeout,
            interruptTimeout,
            appShell,
            controller,
            configService,
            workspaceService,
            outputTracker,
            statusProvider,
            creator,
            context,
            formatters
        );
    }

    protected async getDebugCellHook(): Promise<string[]> {
        if (getAssociatedNotebookDocument(this)?.notebookType === InteractiveWindowView) {
            // If using ipykernel 6, we need to set the IPYKERNEL_CELL_NAME so that
            // debugging can work. However this code is harmless for IPYKERNEL 5 so just always do it
            return addRunCellHook.splitLines({ trim: false });
        }
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
