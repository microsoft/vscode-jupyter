// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { NotebookController, NotebookDocument, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../platform/common/application/types';
import { CodeSnippets, InteractiveWindowView } from '../platform/common/constants';
import { traceInfo, traceError } from '../platform/logging';
import { IPythonExecutionFactory } from '../platform/common/process/types.node';
import { Resource, IConfigurationService, IExtensionContext } from '../platform/common/types';
import { calculateWorkingDirectory } from '../platform/common/utils.node';
import { isLocalHostConnection, isPythonKernelConnection } from './helpers';
import { expandWorkingDir } from './jupyter/jupyterUtils';
import {
    INotebookProvider,
    isLocalConnection,
    ITracebackFormatter,
    KernelActionSource,
    KernelConnectionMetadata
} from './types';
import { AddRunCellHook } from '../platform/common/scriptConstants';
import { IStatusProvider } from '../platform/progress/types';
import { sendTelemetryForPythonKernelExecutable } from './helpers.node';
import { BaseKernel } from './kernel.base';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { IFileSystem } from '../platform/common/platform/types';

export class Kernel extends BaseKernel {
    constructor(
        uri: Uri,
        resourceUri: Resource,
        notebook: NotebookDocument | undefined,
        kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        notebookProvider: INotebookProvider,
        launchTimeout: number,
        interruptTimeout: number,
        appShell: IApplicationShell,
        private readonly fs: IFileSystem,
        controller: NotebookController,
        configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        workspaceService: IWorkspaceService,
        private readonly pythonExecutionFactory: IPythonExecutionFactory,
        statusProvider: IStatusProvider,
        creator: KernelActionSource,
        context: IExtensionContext,
        formatters: ITracebackFormatter[]
    ) {
        super(
            uri,
            resourceUri,
            notebook,
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
        const useNewDebugger = this.configService.getSettings(undefined).forceIPyKernelDebugger === true;
        if (useNewDebugger) {
            return [];
        }
        if (!isLocalConnection(this.kernelConnectionMetadata)) {
            return [];
        }
        // Only do this for interactive windows. IPYKERNEL_CELL_NAME is set other ways in
        // notebooks
        if (this.notebook?.notebookType === InteractiveWindowView) {
            // If using ipykernel 6, we need to set the IPYKERNEL_CELL_NAME so that
            // debugging can work. However this code is harmless for IPYKERNEL 5 so just always do it
            const scriptPath = AddRunCellHook.getScriptPath(this.context);
            if (await this.fs.exists(scriptPath)) {
                const fileContents = await this.fs.readFile(scriptPath);
                return fileContents.splitLines({ trim: false });
            }
            traceError(`Cannot run non-existent script file: ${scriptPath}`);
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
            if (suggestedDir && (await this.fs.exists(suggestedDir))) {
                traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                // We should use the launch info directory. It trumps the possible dir
                return this.getChangeDirectoryCode(suggestedDir);
            } else if (launchingFile && (await this.fs.exists(launchingFile))) {
                // Combine the working directory with this file if possible.
                suggestedDir = Uri.file(
                    expandWorkingDir(
                        getFilePath(suggestedDir),
                        launchingFile,
                        this.workspaceService,
                        this.configService.getSettings(launchingFile)
                    )
                );
                if (suggestedDir && (await this.fs.exists(suggestedDir))) {
                    traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                    return this.getChangeDirectoryCode(suggestedDir);
                }
            }
        }
        return [];
    }

    // Update both current working directory and sys.path with the desired directory
    private getChangeDirectoryCode(directory: Uri): string[] {
        if (
            (isLocalConnection(this.kernelConnectionMetadata) ||
                isLocalHostConnection(this.kernelConnectionMetadata)) &&
            isPythonKernelConnection(this.kernelConnectionMetadata)
        ) {
            return CodeSnippets.UpdateCWDAndPath.format(getFilePath(directory)).splitLines({ trim: false });
        }
        return [];
    }

    protected override async sendTelemetryForPythonKernelExecutable() {
        if (this.session) {
            return sendTelemetryForPythonKernelExecutable(
                this.session,
                this.resourceUri,
                this.kernelConnectionMetadata,
                this.pythonExecutionFactory
            );
        }
    }
}
