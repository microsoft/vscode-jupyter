// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { EventEmitter, NotebookCell, NotebookCellKind, NotebookDocument, workspace } from 'vscode';
import { CellExecutionFactory } from './cellExecution';
import { CellExecutionQueue } from './cellExecutionQueue';
import { KernelMessage } from '@jupyterlab/services';
import { IApplicationShell } from '../../platform/common/application/types';
import { traceInfo, traceInfoIfCI, traceWarning } from '../../platform/logging';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { createDeferred, waitForPromise } from '../../platform/common/utils/async';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { sendKernelTelemetryEvent } from '../telemetry/sendKernelTelemetryEvent';
import { trackKernelResourceInformation } from '../telemetry/helper';
import { capturePerfTelemetry, Telemetry } from '../../telemetry';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import {
    IKernelConnectionSession,
    IThirdPartyKernel,
    InterruptResult,
    ITracebackFormatter,
    NotebookCellRunState,
    IKernel,
    IBaseKernel
} from '../../kernels/types';
import { traceCellMessage } from './helpers';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { CellExecutionMessageHandlerService } from './cellExecutionMessageHandlerService';
import { noop } from '../../platform/common/utils/misc';

/**
 * Separate class that deals just with kernel execution.
 * Else the `Kernel` class gets very big.
 */
export class BaseKernelExecution<TKernel extends IBaseKernel = IBaseKernel> implements IDisposable {
    protected readonly disposables: IDisposable[] = [];
    private disposed?: boolean;
    private _interruptPromise?: Promise<InterruptResult>;
    private _restartPromise?: Promise<void>;
    protected get restarting() {
        return this._restartPromise || Promise.resolve();
    }
    constructor(protected readonly kernel: TKernel, private readonly interruptTimeout: number) {}

    public async cancel() {
        noop();
    }

    /**
     * Interrupts the execution of cells.
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public async interrupt(sessionPromise?: Promise<IKernelConnectionSession>): Promise<InterruptResult> {
        const session = sessionPromise ? await sessionPromise.catch(() => undefined) : undefined;
        const pendingExecutions = this.cancelPendingExecutions();
        traceInfo('Interrupt kernel execution');

        if (!session) {
            traceInfo('No kernel session to interrupt');
            this._interruptPromise = undefined;
            await pendingExecutions;
            return InterruptResult.Success;
        }

        // Interrupt the active execution
        const result = this._interruptPromise
            ? await this._interruptPromise
            : await (this._interruptPromise = this.interruptExecution(session, pendingExecutions));

        // Done interrupting, clear interrupt promise
        this._interruptPromise = undefined;

        return result;
    }
    protected async cancelPendingExecutions(): Promise<void> {
        noop();
    }
    /**
     * Restarts the kernel
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public async restart(sessionPromise?: Promise<IKernelConnectionSession>): Promise<void> {
        const session = sessionPromise ? await sessionPromise.catch(() => undefined) : undefined;

        if (!session) {
            traceInfo('No kernel session to interrupt');
            this._restartPromise = undefined;
            return;
        }

        // Restart the active execution
        if (!this._restartPromise) {
            this._restartPromise = this.restartExecution(session);
            this._restartPromise
                // Done restarting, clear restart promise
                .finally(() => (this._restartPromise = undefined))
                .catch(noop);
        }
        await this._restartPromise;
    }
    public dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        traceInfoIfCI(`Dispose KernelExecution`);
        this.disposables.forEach((d) => d.dispose());
    }
    @capturePerfTelemetry(Telemetry.Interrupt)
    private async interruptExecution(
        session: IKernelConnectionSession,
        pendingExecutions: Promise<unknown>
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
                    Promise.race([pendingExecutions, restarted.promise]),
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
                    { duration: stopWatch.elapsedTime },
                    undefined,
                    exc
                );
                throw exc;
            } finally {
                restartHandlerToken.dispose();
            }
        })();

        return promise.then((result) => {
            sendKernelTelemetryEvent(
                this.kernel.resourceUri,
                Telemetry.NotebookInterrupt,
                { duration: stopWatch.elapsedTime },
                {
                    result
                }
            );
            return result;
        });
    }

    @capturePerfTelemetry(Telemetry.RestartKernel)
    private async restartExecution(session: IKernelConnectionSession): Promise<void> {
        // Just use the internal session. Pending cells should have been canceled by the caller
        await session.restart();
    }
}

export class ThirdPartyKernelExecution extends BaseKernelExecution<IThirdPartyKernel> {}

/**
 * Separate class that deals just with kernel execution.
 * Else the `Kernel` class gets very big.
 */
export class KernelExecution extends BaseKernelExecution<IKernel> {
    private readonly documentExecutions = new WeakMap<NotebookDocument, CellExecutionQueue>();
    private readonly executionFactory: CellExecutionFactory;
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    constructor(
        kernel: IKernel,
        appShell: IApplicationShell,
        interruptTimeout: number,
        outputTracker: CellOutputDisplayIdTracker,
        context: IExtensionContext,
        formatters: ITracebackFormatter[]
    ) {
        super(kernel, interruptTimeout);
        const requestListener = new CellExecutionMessageHandlerService(
            appShell,
            kernel.controller,
            outputTracker,
            context,
            formatters
        );
        this.disposables.push(requestListener);
        this.executionFactory = new CellExecutionFactory(this.kernel.controller, requestListener);
    }

    public get onPreExecute() {
        return this._onPreExecute.event;
    }
    public get queue() {
        return this.documentExecutions.get(this.kernel.notebook)?.queue || [];
    }
    public async executeCell(
        sessionPromise: Promise<IKernelConnectionSession>,
        cell: NotebookCell,
        codeOverride?: string
    ): Promise<NotebookCellRunState> {
        traceCellMessage(cell, `KernelExecution.executeCell (1), ${getDisplayPath(cell.notebook.uri)}`);
        if (cell.kind == NotebookCellKind.Markup) {
            return NotebookCellRunState.Success;
        }

        // If we're restarting, wait for it to finish
        await this.restarting;

        traceCellMessage(cell, `KernelExecution.executeCell (2), ${getDisplayPath(cell.notebook.uri)}`);
        const executionQueue = this.getOrCreateCellExecutionQueue(cell.notebook, sessionPromise);
        executionQueue.queueCell(cell, codeOverride);
        const result = await executionQueue.waitForCompletion([cell]);
        traceCellMessage(cell, `KernelExecution.executeCell completed (3), ${getDisplayPath(cell.notebook.uri)}`);
        return result[0];
    }
    public override async cancel() {
        await super.cancel();
        const executionQueue = this.documentExecutions.get(this.kernel.notebook);
        if (executionQueue) {
            await executionQueue.cancel(true);
        }
    }

    /**
     * Interrupts the execution of cells.
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public override async interrupt(sessionPromise?: Promise<IKernelConnectionSession>): Promise<InterruptResult> {
        await trackKernelResourceInformation(this.kernel.resourceUri, { interruptKernel: true });
        const executionQueue = this.documentExecutions.get(this.kernel.notebook);
        if (!executionQueue && this.kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            return InterruptResult.Success;
        }
        return super.interrupt(sessionPromise);
    }
    protected override async cancelPendingExecutions(): Promise<void> {
        const executionQueue = this.documentExecutions.get(this.kernel.notebook);
        if (!executionQueue && this.kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            return;
        }
        traceInfo('Interrupt kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        const pendingCells = executionQueue
            ? executionQueue.cancel().then(() => executionQueue.waitForCompletion())
            : Promise.resolve();

        await pendingCells;
    }
    /**
     * Restarts the kernel
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public override async restart(sessionPromise?: Promise<IKernelConnectionSession>): Promise<void> {
        await trackKernelResourceInformation(this.kernel.resourceUri, { restartKernel: true });
        const executionQueue = this.documentExecutions.get(this.kernel.notebook);
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

        return super.restart(sessionPromise);
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
}
