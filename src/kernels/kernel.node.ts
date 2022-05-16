// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { NotebookController, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../platform/common/application/types';
import { traceInfo, traceError } from '../platform/logging';
import { IFileSystemNode } from '../platform/common/platform/types.node';
import { IPythonExecutionFactory } from '../platform/common/process/types.node';
import { Resource, IDisposableRegistry, IConfigurationService, IExtensionContext } from '../platform/common/types';
import { CellHashProviderFactory } from '../interactive-window/editor-integration/cellHashProviderFactory';
import { InteractiveWindowView } from '../notebooks/constants';
import { calculateWorkingDirectory } from '../platform/common/utils.node';
import { CodeSnippets } from '../webviews/webview-side/common/constants';
import { CellOutputDisplayIdTracker } from '../notebooks/execution/cellDisplayIdTracker';
import { isLocalHostConnection, isPythonKernelConnection } from './helpers';
import { expandWorkingDir } from './jupyter/jupyterUtils';
import { INotebookProvider, isLocalConnection, KernelActionSource, KernelConnectionMetadata } from './types';
import { AddRunCellHook } from '../platform/common/constants.node';
import { IStatusProvider } from '../platform/progress/types';
import { getAssociatedNotebookDocument } from '../notebooks/controllers/kernelSelector';
import { sendTelemetryForPythonKernelExecutable } from './helpers.node';
import { BaseKernel } from './kernel.base';

export class Kernel extends BaseKernel {
    constructor(
        id: Uri,
        resourceUri: Resource,
        kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        notebookProvider: INotebookProvider,
        disposables: IDisposableRegistry,
        launchTimeout: number,
        interruptTimeout: number,
        appShell: IApplicationShell,
        private readonly fs: IFileSystemNode,
        controller: NotebookController,
        configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        cellHashProviderFactory: CellHashProviderFactory,
        workspaceService: IWorkspaceService,
        private readonly pythonExecutionFactory: IPythonExecutionFactory,
        statusProvider: IStatusProvider,
        creator: KernelActionSource,
        context: IExtensionContext
    ) {
        super(
            id,
            resourceUri,
            kernelConnectionMetadata,
            notebookProvider,
            disposables,
            launchTimeout,
            interruptTimeout,
            appShell,
            controller,
            configService,
            workspaceService,
            outputTracker,
            cellHashProviderFactory,
            statusProvider,
            creator,
            context
        );
    }

    protected async getDebugCellHook(): Promise<string[]> {
        // Only do this for interactive windows. IPYKERNEL_CELL_NAME is set other ways in
        // notebooks
        if (getAssociatedNotebookDocument(this)?.notebookType === InteractiveWindowView) {
            // If using ipykernel 6, we need to set the IPYKERNEL_CELL_NAME so that
            // debugging can work. However this code is harmless for IPYKERNEL 5 so just always do it
            if (await this.fs.localFileExists(AddRunCellHook.ScriptPath)) {
                const fileContents = await this.fs.readLocalFile(AddRunCellHook.ScriptPath);
                return fileContents.splitLines({ trim: false });
            }
            traceError(`Cannot run non-existent script file: ${AddRunCellHook.ScriptPath}`);
        }
        return [];
    }

    protected async getUpdateWorkingDirectoryAndPathCode(launchingFile?: Resource): Promise<string[]> {
        if (
            (isLocalConnection(this.kernelConnectionMetadata) ||
                isLocalHostConnection(this.kernelConnectionMetadata)) &&
            this.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel' // Skip for live kernel. Don't change current directory on a kernel that's already running
        ) {
            let suggestedDir = await calculateWorkingDirectory(
                this.configService,
                this.workspaceService,
                this.fs,
                launchingFile
            );
            if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                // We should use the launch info directory. It trumps the possible dir
                return this.getChangeDirectoryCode(suggestedDir);
            } else if (launchingFile && (await this.fs.localFileExists(launchingFile.fsPath))) {
                // Combine the working directory with this file if possible.
                suggestedDir = expandWorkingDir(
                    suggestedDir,
                    launchingFile,
                    this.workspaceService,
                    this.configService.getSettings(launchingFile)
                );
                if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                    traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                    return this.getChangeDirectoryCode(suggestedDir);
                }
            }
        }
        return [];
    }

    // Update both current working directory and sys.path with the desired directory
    private getChangeDirectoryCode(directory: string): string[] {
        if (
            (isLocalConnection(this.kernelConnectionMetadata) ||
                isLocalHostConnection(this.kernelConnectionMetadata)) &&
            isPythonKernelConnection(this.kernelConnectionMetadata)
        ) {
            return CodeSnippets.UpdateCWDAndPath.format(directory).splitLines({ trim: false });
        }
        return [];
    }

    protected override sendTelemetryForPythonKernelExecutable() {
        return sendTelemetryForPythonKernelExecutable(
            this,
            this.resourceUri,
            this.kernelConnectionMetadata,
            this.pythonExecutionFactory
        );
    }
}
