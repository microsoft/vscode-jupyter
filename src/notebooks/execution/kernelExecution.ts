// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { EventEmitter, NotebookCell, NotebookCellKind, NotebookController, NotebookDocument, workspace } from 'vscode';
import { CellExecutionFactory } from './cellExecution';
import { CellExecutionQueue } from './cellExecutionQueue';
import { KernelMessage } from '@jupyterlab/services';
import { IApplicationShell } from '../../client/common/application/types';
import { traceInfo, traceInfoIfCI, traceWarning } from '../../client/common/logger';
import { IDisposable, IDisposableRegistry } from '../../client/common/types';
import { createDeferred, waitForPromise } from '../../client/common/utils/async';
import { StopWatch } from '../../client/common/utils/stopWatch';
import { CellHashProviderFactory } from '../../interactive-window/editor-integration/cellHashProviderFactory';
import { trackKernelResourceInformation, sendKernelTelemetryEvent } from '../../client/datascience/telemetry/telemetry';
import { InterruptResult, IJupyterSession } from '../../client/datascience/types';
import { captureTelemetry } from '../../client/telemetry';
import { Telemetry } from '../../datascience-ui/common/constants';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { IKernel, KernelConnectionMetadata, NotebookCellRunState } from '../../kernels/types';
import { traceCellMessage } from '../helpers';
import { getDisplayPath } from '../../client/common/platform/fs-paths';

/**
 * Separate class that deals just with kernel execution.
 * Else the `Kernel` class gets very big.
 */
export class KernelExecution implements IDisposable {
    private readonly documentExecutions = new WeakMap<NotebookDocument, CellExecutionQueue>();
    private readonly executionFactory: CellExecutionFactory;
    private readonly disposables: IDisposable[] = [];
    private _interruptPromise?: Promise<InterruptResult>;
    private _restartPromise?: Promise<void>;
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    constructor(
        private readonly kernel: IKernel,
        appShell: IApplicationShell,
        readonly metadata: Readonly<KernelConnectionMetadata>,
        private readonly interruptTimeout: number,
        disposables: IDisposableRegistry,
        controller: NotebookController,
        outputTracker: CellOutputDisplayIdTracker,
        cellHashProviderFactory: CellHashProviderFactory
    ) {
        this.executionFactory = new CellExecutionFactory(
            kernel,
            appShell,
            disposables,
            controller,
            outputTracker,
            cellHashProviderFactory
        );
    }

    public get onPreExecute() {
        return this._onPreExecute.event;
    }
    public get queue() {
        return this.documentExecutions.get(this.kernel.notebookDocument)?.queue || [];
    }
    public async executeCell(
        sessionPromise: Promise<IJupyterSession>,
        cell: NotebookCell
    ): Promise<NotebookCellRunState> {
        traceCellMessage(cell, `KernelExecution.executeCell (1), ${getDisplayPath(cell.notebook.uri)}`);
        if (cell.kind == NotebookCellKind.Markup) {
            return NotebookCellRunState.Success;
        }

        // If we're restarting, wait for it to finish
        if (this._restartPromise) {
            await this._restartPromise;
        }

        traceCellMessage(cell, `KernelExecution.executeCell (2), ${getDisplayPath(cell.notebook.uri)}`);
        const executionQueue = this.getOrCreateCellExecutionQueue(cell.notebook, sessionPromise);
        executionQueue.queueCell(cell);
        const result = await executionQueue.waitForCompletion([cell]);
        traceCellMessage(cell, `KernelExecution.executeCell completed (3), ${getDisplayPath(cell.notebook.uri)}`);
        return result[0];
    }
    public async cancel() {
        const executionQueue = this.documentExecutions.get(this.kernel.notebookDocument);
        if (executionQueue) {
            await executionQueue.cancel(true);
        }
    }

    /**
     * Interrupts the execution of cells.
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public async interrupt(sessionPromise?: Promise<IJupyterSession>): Promise<InterruptResult> {
        trackKernelResourceInformation(this.kernel.resourceUri, { interruptKernel: true });
        const executionQueue = this.documentExecutions.get(this.kernel.notebookDocument);
        if (!executionQueue && this.kernel.kernelConnectionMetadata.kind !== 'connectToLiveKernel') {
            return InterruptResult.Success;
        }
        // Possible we don't have a notebook.
        const session = sessionPromise ? await sessionPromise.catch(() => undefined) : undefined;
        traceInfo('Interrupt kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        const pendingCells = executionQueue
            ? executionQueue.cancel().then(() => executionQueue.waitForCompletion())
            : Promise.resolve();

        if (!session) {
            traceInfo('No notebook to interrupt');
            this._interruptPromise = undefined;
            await pendingCells;
            return InterruptResult.Success;
        }

        // Interrupt the active execution
        const result = this._interruptPromise
            ? await this._interruptPromise
            : await (this._interruptPromise = this.interruptExecution(session, pendingCells));

        // Done interrupting, clear interrupt promise
        this._interruptPromise = undefined;

        return result;
    }
    /**
     * Restarts the kernel
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public async restart(sessionPromise?: Promise<IJupyterSession>): Promise<void> {
        trackKernelResourceInformation(this.kernel.resourceUri, { restartKernel: true });
        const executionQueue = this.documentExecutions.get(this.kernel.notebookDocument);
        if (!executionQueue) {
            return;
        }
        // Possible we don't have a notebook.
        const session = sessionPromise ? await sessionPromise.catch(() => undefined) : undefined;
        traceInfo('Restart kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        const pendingCells = executionQueue.cancel(true).then(() => executionQueue.waitForCompletion());

        if (!session) {
            traceInfo('No notebook to interrupt');
            this._restartPromise = undefined;
            await pendingCells;
            return;
        }

        // Restart the active execution
        if (!this._restartPromise) {
            this._restartPromise = this.restartExecution(session);
            this._restartPromise.finally(() => {
                // Done restarting, clear restart promise
                this._restartPromise = undefined;
            });
        }
        await this._restartPromise;
    }
    public dispose() {
        traceInfoIfCI(`Dispose KernelExecution`);
        this.disposables.forEach((d) => d.dispose());
    }
    private getOrCreateCellExecutionQueue(document: NotebookDocument, sessionPromise: Promise<IJupyterSession>) {
        const existingExecutionQueue = this.documentExecutions.get(document);
        // Re-use the existing Queue if it can be used.
        if (existingExecutionQueue && !existingExecutionQueue.isEmpty && !existingExecutionQueue.failed) {
            return existingExecutionQueue;
        }

        const newCellExecutionQueue = new CellExecutionQueue(sessionPromise, this.executionFactory, this.metadata);
        this.disposables.push(newCellExecutionQueue);

        // If the document is closed (user or on CI), then just stop handling the UI updates & cancel cell execution queue.
        workspace.onDidCloseNotebookDocument(
            async (e: NotebookDocument) => {
                if (e === document) {
                    if (!newCellExecutionQueue.failed || !newCellExecutionQueue.isEmpty) {
                        await newCellExecutionQueue.cancel(true);
                    }
                }
            },
            this,
            this.disposables
        );
        newCellExecutionQueue.onPreExecute((c) => this._onPreExecute.fire(c), this, this.disposables);
        this.documentExecutions.set(document, newCellExecutionQueue);
        return newCellExecutionQueue;
    }
    @captureTelemetry(Telemetry.Interrupt)
    @captureTelemetry(Telemetry.InterruptJupyterTime)
    private async interruptExecution(
        session: IJupyterSession,
        pendingCells: Promise<unknown>
    ): Promise<InterruptResult> {
        const restarted = createDeferred<boolean>();
        const stopWatch = new StopWatch();
        // Listen to status change events so we can tell if we're restarting
        const restartHandler = (e: KernelMessage.Status) => {
            if (e === 'restarting' || e === 'autorestarting') {
                // We restarted the kernel.
                traceWarning('Kernel restarting during interrupt');

                // Indicate we restarted the race below
                restarted.resolve(true);
            }
        };
        const restartHandlerToken = session.onSessionStatusChanged(restartHandler);

        // Start our interrupt. If it fails, indicate a restart
        session.interrupt().catch((exc) => {
            traceWarning(`Error during interrupt: ${exc}`);
            restarted.resolve(true);
        });

        const promise = (async () => {
            try {
                // Wait for all of the pending cells to finish or the timeout to fire
                const result = await waitForPromise(
                    Promise.race([pendingCells, restarted.promise]),
                    this.interruptTimeout
                );

                // See if we restarted or not
                if (restarted.completed) {
                    return InterruptResult.Restarted;
                }

                if (result === null) {
                    // We timed out. You might think we should stop our pending list, but that's not
                    // up to us. The cells are still executing. The user has to request a restart or try again
                    return InterruptResult.TimedOut;
                }

                // Indicate the interrupt worked.
                return InterruptResult.Success;
            } catch (exc) {
                // Something failed. See if we restarted or not.
                if (restarted.completed) {
                    return InterruptResult.Restarted;
                }

                // Otherwise a real error occurred.
                sendKernelTelemetryEvent(
                    this.kernel.resourceUri,
                    Telemetry.NotebookInterrupt,
                    stopWatch.elapsedTime,
                    undefined,
                    exc
                );
                throw exc;
            } finally {
                restartHandlerToken.dispose();
            }
        })();

        return promise.then((result) => {
            sendKernelTelemetryEvent(this.kernel.resourceUri, Telemetry.NotebookInterrupt, stopWatch.elapsedTime, {
                result
            });
            return result;
        });
    }

    @captureTelemetry(Telemetry.RestartKernel)
    @captureTelemetry(Telemetry.RestartJupyterTime)
    private async restartExecution(session: IJupyterSession): Promise<void> {
        // Just use the internal session. Pending cells should have been canceled by the caller
        await session.restart();
    }
}
