// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { NotebookCell, NotebookController, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../platform/common/application/types';
import { traceInfo, traceInfoIfCI, traceError } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IFileSystem } from '../platform/common/platform/types.node';
import { IPythonExecutionFactory } from '../platform/common/process/types.node';
import { Resource, IDisposableRegistry, IConfigurationService } from '../platform/common/types';
import { DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { CellHashProviderFactory } from '../interactive-window/editor-integration/cellHashProviderFactory';
import { InteractiveWindowView } from '../notebooks/constants';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../telemetry/telemetry';
import { calculateWorkingDirectory } from '../platform/common/utils.node';
import { Telemetry, CodeSnippets } from '../webviews/webview-side/common/constants';
import { CellOutputDisplayIdTracker } from '../notebooks/execution/cellDisplayIdTracker';
import { getDisplayNameOrNameOfKernelConnection, isLocalHostConnection, isPythonKernelConnection } from './helpers';
import { expandWorkingDir } from './jupyter/jupyterUtils.node';
import {
    INotebookProvider,
    InterruptResult,
    isLocalConnection,
    KernelConnectionMetadata,
    NotebookCellRunState
} from './types';
import { KernelExecution } from '../notebooks/execution/kernelExecution.node';
import { traceCellMessage } from '../notebooks/helpers';
import { AddRunCellHook } from '../platform/common/constants.node';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';
import { IStatusProvider } from '../platform/progress/types';
import { DisplayOptions } from './displayOptions';
import { getAssociatedNotebookDocument } from '../notebooks/controllers/kernelSelector';
import { sendTelemetryForPythonKernelExecutable } from './helpers.node';
import { BaseKernel } from './kernel.base';

export class Kernel extends BaseKernel {
    private readonly kernelExecution: KernelExecution;
    private disposingPromise?: Promise<void>;
    constructor(
        id: Uri,
        resourceUri: Resource,
        kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        notebookProvider: INotebookProvider,
        disposables: IDisposableRegistry,
        launchTimeout: number,
        interruptTimeout: number,
        appShell: IApplicationShell,
        private readonly fs: IFileSystem,
        controller: NotebookController,
        configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        cellHashProviderFactory: CellHashProviderFactory,
        workspaceService: IWorkspaceService,
        private readonly pythonExecutionFactory: IPythonExecutionFactory,
        private readonly statusProvider: IStatusProvider
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
        this.kernelExecution = new KernelExecution(
            this,
            appShell,
            kernelConnectionMetadata,
            interruptTimeout,
            disposables,
            controller,
            outputTracker,
            cellHashProviderFactory
        );
        this.kernelExecution.onPreExecute((c) => this._onPreExecute.fire(c), this, disposables);
    }

    public get pendingCells(): readonly NotebookCell[] {
        return this.kernelExecution.queue;
    }
    public async executeCell(cell: NotebookCell): Promise<NotebookCellRunState> {
        traceCellMessage(cell, `kernel.executeCell, ${getDisplayPath(cell.notebook.uri)}`);
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.ExecuteCell);
        const stopWatch = new StopWatch();
        const sessionPromise = this.startNotebook().then((nb) => nb.session);
        const promise = this.kernelExecution.executeCell(sessionPromise, cell);
        this.trackNotebookCellPerceivedColdTime(stopWatch, sessionPromise, promise).catch(noop);
        void promise.then((state) => traceInfo(`Cell ${cell.index} executed with state ${state}`));
        return promise;
    }
    public async interrupt(): Promise<void> {
        await Promise.all(this.eventHooks.map((h) => h('willInterrupt')));
        trackKernelResourceInformation(this.resourceUri, { interruptKernel: true });
        if (this.restarting) {
            traceInfo(`Interrupt requested & currently restarting ${getDisplayPath(this.resourceUri || this.id)}`);
            await this.restarting.promise;
        }
        traceInfo(`Interrupt requested ${getDisplayPath(this.resourceUri || this.id)}`);
        this.startCancellation.cancel();
        const interruptResultPromise = this.kernelExecution.interrupt(
            this._notebookPromise?.then((item) => item.session)
        );

        const status = this.statusProvider.set(DataScience.interruptKernelStatus());
        let result: InterruptResult | undefined;
        try {
            traceInfo(
                `Interrupt requested & sent for ${getDisplayPath(this.resourceUri || this.id)} in notebookEditor.`
            );
            result = await interruptResultPromise;
            if (result === InterruptResult.TimedOut) {
                const message = DataScience.restartKernelAfterInterruptMessage();
                const yes = DataScience.restartKernelMessageYes();
                const no = DataScience.restartKernelMessageNo();
                const v = await this.appShell.showInformationMessage(message, { modal: true }, yes, no);
                if (v === yes) {
                    await this.restart();
                }
            }
        } finally {
            status.dispose();
        }
    }
    public async dispose(): Promise<void> {
        traceInfoIfCI(`Dispose Kernel for ${getDisplayPath(this.resourceUri || this.id)}`);
        this._disposing = true;
        if (this.disposingPromise) {
            return this.disposingPromise;
        }
        this._ignoreNotebookDisposedErrors = true;
        this.startCancellation.cancel();
        const disposeImpl = async () => {
            traceInfo(`Dispose kernel for ${getDisplayPath(this.resourceUri || this.id)}`);
            this.restarting = undefined;
            const promises: Promise<void>[] = [];
            promises.push(this.kernelExecution.cancel());
            this.notebook = this.notebook
                ? this.notebook
                : this._notebookPromise
                ? await this._notebookPromise
                : undefined;
            this._notebookPromise = undefined;
            if (this.notebook) {
                promises.push(this.notebook.session.dispose().catch(noop));
                this.notebook = undefined;
            }
            this._disposed = true;
            this._onDisposed.fire();
            this._onStatusChanged.fire('dead');
            this.kernelExecution.dispose();
            await Promise.all(promises);
        };
        this.disposingPromise = disposeImpl();
        await this.disposingPromise;
    }
    public async restart(): Promise<void> {
        if (this.restarting) {
            return this.restarting.promise;
        }
        await Promise.all(this.eventHooks.map((h) => h('willRestart')));
        traceInfo(`Restart requested for ${getDisplayPath(this.resourceUri || this.id)}`);
        this.startCancellation.cancel();
        // Set our status
        const status = this.statusProvider.set(DataScience.restartingKernelStatus().format(''));
        const progress = KernelProgressReporter.createProgressReporter(
            this.resourceUri,
            DataScience.restartingKernelStatus().format(
                `: ${getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)}`
            )
        );

        const stopWatch = new StopWatch();
        try {
            // If the notebook died, then start a new notebook.
            await (this._notebookPromise
                ? this.kernelExecution.restart(this._notebookPromise?.then((item) => item.session))
                : this.start(new DisplayOptions(false)));
            sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (ex) {
            traceError(`Restart failed ${getDisplayPath(this.resourceUri || this.id)}`, ex);
            this._ignoreNotebookDisposedErrors = true;
            // If restart fails, kill the associated notebook.
            const notebook = this.notebook;
            this.notebook = undefined;
            this._notebookPromise = undefined;
            this.restarting = undefined;
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime, undefined, ex);
            await notebook?.session.dispose().catch(noop);
            this._ignoreNotebookDisposedErrors = false;
            throw ex;
        } finally {
            status.dispose();
            progress.dispose();
        }

        // Interactive window needs a restart sys info
        await this.initializeAfterStart(this.notebook);

        // Indicate a restart occurred if it succeeds
        this._onRestarted.fire();
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
            traceError(`Cannot run non-existant script file: ${AddRunCellHook.ScriptPath}`);
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
                suggestedDir = expandWorkingDir(suggestedDir, launchingFile.fsPath, this.workspaceService);
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
