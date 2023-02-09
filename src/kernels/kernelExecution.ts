// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IOutput } from '@jupyterlab/nbformat';
import { NotebookCell, EventEmitter, notebooks, NotebookCellExecutionState, NotebookDocument, workspace } from 'vscode';
import { NotebookCellKind } from 'vscode-languageserver-protocol';
import { IApplicationShell } from '../platform/common/application/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IDisposable, IExtensionContext } from '../platform/common/types';
import { traceInfo, traceVerbose } from '../platform/logging';
import { Telemetry } from '../telemetry';
import { DisplayOptions } from './displayOptions';
import { CellExecutionFactory } from './execution/cellExecution';
import { CellExecutionMessageHandlerService } from './execution/cellExecutionMessageHandlerService';
import { CellExecutionQueue } from './execution/cellExecutionQueue';
import { traceCellMessage } from './execution/helpers';
import { executeSilently } from './helpers';
import { initializeInteractiveOrNotebookTelemetryBasedOnUserAction } from './telemetry/helper';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';
import {
    IKernel,
    IKernelConnectionSession,
    INotebookKernelExecution,
    ITracebackFormatter,
    NotebookCellRunState
} from './types';

/**
 * Everything in this classes gets disposed via the `onWillCancel` hook.
 */
export class NotebookKernelExecution implements INotebookKernelExecution {
    private readonly disposables: IDisposable[] = [];
    get executionCount(): number {
        return this._visibleExecutionCount;
    }
    private _visibleExecutionCount = 0;
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    public readonly onPreExecute = this._onPreExecute.event;
    private readonly _onPostExecute = new EventEmitter<NotebookCell>();
    public readonly onPostExecute = this._onPostExecute.event;
    private readonly documentExecutions = new WeakMap<NotebookDocument, CellExecutionQueue>();
    private readonly executionFactory: CellExecutionFactory;

    constructor(
        private readonly kernel: IKernel,
        appShell: IApplicationShell,
        context: IExtensionContext,
        formatters: ITracebackFormatter[],
        private readonly notebook: NotebookDocument
    ) {
        const requestListener = new CellExecutionMessageHandlerService(
            appShell,
            kernel.controller,
            context,
            formatters
        );
        this.disposables.push(requestListener);
        this.executionFactory = new CellExecutionFactory(kernel.controller, requestListener);

        notebooks.onDidChangeNotebookCellExecutionState((e) => {
            if (e.cell.notebook === kernel.notebook) {
                if (e.state === NotebookCellExecutionState.Idle && e.cell.executionSummary?.executionOrder) {
                    this._visibleExecutionCount = Math.max(
                        this._visibleExecutionCount,
                        e.cell.executionSummary.executionOrder
                    );
                }
            }
        });
        kernel.onRestarted(() => (this._visibleExecutionCount = 0), this, this.disposables);
        kernel.onStarted(() => (this._visibleExecutionCount = 0), this, this.disposables);
        kernel.addHook('willInterrupt', this.onWillInterrupt, this, this.disposables);
        kernel.addHook('willCancel', this.onWillCancel, this, this.disposables);
        kernel.addHook('willRestart', (sessionPromise) => this.onWillRestart(sessionPromise), this, this.disposables);
        this.disposables.push(this._onPreExecute);
    }
    public get pendingCells(): readonly NotebookCell[] {
        return this.documentExecutions.get(this.notebook)?.queue || [];
    }

    public async executeCell(cell: NotebookCell, codeOverride?: string | undefined): Promise<NotebookCellRunState> {
        traceCellMessage(cell, `KernelExecution.executeCell (1), ${getDisplayPath(cell.notebook.uri)}`);
        if (cell.kind == NotebookCellKind.Markup) {
            return NotebookCellRunState.Success;
        }

        traceCellMessage(cell, `kernel.executeCell, ${getDisplayPath(cell.notebook.uri)}`);
        await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
            this.kernel.resourceUri,
            this.kernel.kernelConnectionMetadata
        );
        sendKernelTelemetryEvent(this.kernel.resourceUri, Telemetry.ExecuteCell);
        const sessionPromise = this.kernel.start(new DisplayOptions(false));

        // If we're restarting, wait for it to finish
        await this.kernel.restarting;

        traceCellMessage(cell, `KernelExecution.executeCell (2), ${getDisplayPath(cell.notebook.uri)}`);
        const executionQueue = this.getOrCreateCellExecutionQueue(cell.notebook, sessionPromise);
        executionQueue.queueCell(cell, codeOverride);
        const result = await executionQueue.waitForCompletion([cell]);

        traceCellMessage(cell, `KernelExecution.executeCell completed (3), ${getDisplayPath(cell.notebook.uri)}`);
        traceVerbose(`Cell ${cell.index} executed with state ${result[0]}`);

        return result[0];
    }
    executeHidden(code: string): Promise<IOutput[]> {
        const sessionPromise = this.kernel.start();
        return sessionPromise.then((session) => executeSilently(session, code));
    }
    private async onWillInterrupt() {
        const executionQueue = this.documentExecutions.get(this.notebook);
        if (!executionQueue && this.kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            return;
        }
        traceInfo('Interrupt kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        if (executionQueue) {
            await executionQueue.cancel();
            await executionQueue.waitForCompletion();
        }
    }
    private async onWillCancel() {
        const executionQueue = this.documentExecutions.get(this.notebook);
        if (executionQueue) {
            await executionQueue.cancel(true);
        }
    }
    /**
     * Restarts the kernel
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    private async onWillRestart(sessionPromise?: Promise<IKernelConnectionSession>) {
        const executionQueue = this.documentExecutions.get(this.notebook);
        // Possible we don't have a notebook.
        const session = sessionPromise ? await sessionPromise.catch(() => undefined) : undefined;
        traceInfo('Restart kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        const pendingCells = executionQueue
            ? executionQueue.cancel(true).then(() => executionQueue.waitForCompletion())
            : Promise.resolve();

        if (!session) {
            traceInfo('No kernel session to interrupt');
            await pendingCells;
        }
    }
    private getOrCreateCellExecutionQueue(
        document: NotebookDocument,
        sessionPromise: Promise<IKernelConnectionSession>
    ) {
        const existingExecutionQueue = this.documentExecutions.get(document);
        // Re-use the existing Queue if it can be used.
        if (existingExecutionQueue && !existingExecutionQueue.isEmpty && !existingExecutionQueue.failed) {
            return existingExecutionQueue;
        }

        const newCellExecutionQueue = new CellExecutionQueue(
            sessionPromise,
            this.executionFactory,
            this.kernel.kernelConnectionMetadata,
            this.kernel.resourceUri
        );
        this.disposables.push(newCellExecutionQueue);

        // If the document is closed (user or on CI), then just stop handling the UI updates & cancel cell execution queue.
        workspace.onDidCloseNotebookDocument(
            async (e: NotebookDocument) => {
                if (e === document) {
                    traceVerbose(`Cancel executions after closing notebook ${getDisplayPath(e.uri)}`);
                    if (!newCellExecutionQueue.failed || !newCellExecutionQueue.isEmpty) {
                        await newCellExecutionQueue.cancel(true);
                    }
                }
            },
            this,
            this.disposables
        );
        newCellExecutionQueue.onPreExecute((c) => this._onPreExecute.fire(c), this, this.disposables);
        newCellExecutionQueue.onPostExecute((c) => this._onPostExecute.fire(c), this, this.disposables);
        this.documentExecutions.set(document, newCellExecutionQueue);
        return newCellExecutionQueue;
    }
}
