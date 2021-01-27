// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { CancellationTokenSource, NotebookCell, NotebookCellRunState, NotebookDocument } from 'vscode';
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell, IVSCodeNotebook } from '../../../common/application/types';
import { traceError, traceInfo, traceWarning } from '../../../common/logger';
import { IDisposable, IExtensionContext } from '../../../common/types';
import { ChainedExecutions, createDeferred, waitForPromise } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { captureTelemetry } from '../../../telemetry';
import { Telemetry, VSCodeNativeTelemetry } from '../../constants';
import { traceCellMessage } from '../../notebook/helpers/helpers';
import { chainWithPendingUpdates } from '../../notebook/helpers/notebookUpdater';
import {
    IDataScienceErrorHandler,
    IJupyterSession,
    INotebook,
    INotebookEditorProvider,
    InterruptResult,
    IRawNotebookSupportedService
} from '../../types';
import { CellExecution, CellExecutionFactory } from './cellExecution';
import { isPythonKernelConnection } from './helpers';
import type { IKernel, IKernelProvider, IKernelSelectionUsage, KernelConnectionMetadata } from './types';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

/**
 * Separate class that deals just with kernel execution.
 * Else the `Kernel` class gets very big.
 */
export class KernelExecution implements IDisposable {
    private readonly cellExecutions = new WeakMap<NotebookCell, CellExecution>();

    private readonly documentExecutions = new WeakMap<NotebookDocument, CancellationTokenSource>();
    private readonly stackOfCellsToExecuteByDocument = new WeakMap<NotebookDocument, CellExecution[]>();

    private readonly kernelValidated = new WeakMap<NotebookDocument, { kernel: IKernel; promise: Promise<void> }>();

    private readonly executionFactory: CellExecutionFactory;
    private readonly disposables: IDisposable[] = [];
    private readonly pendingExecution = new ChainedExecutions<void>();
    private readonly pendingCellExecution = new ChainedExecutions<NotebookCellRunState | undefined>();
    private isRawNotebookSupported?: Promise<boolean>;
    private readonly kernelRestartHandlerAdded = new WeakSet<IKernel>();
    private _interruptPromise?: Promise<InterruptResult>;
    constructor(
        private readonly kernelProvider: IKernelProvider,
        errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        readonly kernelSelectionUsage: IKernelSelectionUsage,
        readonly appShell: IApplicationShell,
        readonly vscNotebook: IVSCodeNotebook,
        readonly metadata: Readonly<KernelConnectionMetadata>,
        private readonly rawNotebookSupported: IRawNotebookSupportedService,
        context: IExtensionContext,
        private readonly interruptTimeout: number
    ) {
        this.executionFactory = new CellExecutionFactory(errorHandler, editorProvider, appShell, vscNotebook, context);
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    public async executeCell(notebookPromise: Promise<INotebook>, cell: NotebookCell): Promise<void> {
        // Return current execution.
        if (this.cellExecutions.get(cell)) {
            traceError(`Cell already executing/queued for execution, requested re-execution of ${cell.index}`);
            await this.cellExecutions.get(cell)!.result;
            return;
        }
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === cell.notebook);
        if (!editor) {
            return;
        }
        const cellExecution = this.createQueuedCellExecution(cell);
        try {
            await this.pendingExecution.chainExecution(() => this.executeQueuedCells(notebookPromise, cell.notebook));
        } catch (ex) {
            // Possible one cell failed, we need to stop everything else.
            traceError(`Failed to execute a cell ${cell.index}, hence cancelling all`, ex);
            await this.cancelAllCells(notebookPromise, cell.notebook);
            throw ex;
        } finally {
            traceCellMessage(cell, 'executeCell completed in KernelExecution');
            this.cellExecutions.delete(cell);
            await cellExecution.cancel();
        }
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    @captureTelemetry(VSCodeNativeTelemetry.RunAllCells, undefined, true)
    public async executeAllCells(notebookPromise: Promise<INotebook>, document: NotebookDocument): Promise<void> {
        if (this.documentExecutions.has(document)) {
            traceError(`Document already executing/queued for execution, requested re-execution of ${document.uri}`);
            return;
        }
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === document);
        if (!editor) {
            return;
        }
        this.documentExecutions.set(document, new CancellationTokenSource());

        traceInfo('Update notebook execution state as running');
        await chainWithPendingUpdates(editor, (edit) =>
            edit.replaceMetadata({ ...document.metadata, runState: vscodeNotebookEnums.NotebookRunState.Running })
        );
        document.cells
            .filter((cell) => cell.cellKind === vscodeNotebookEnums.CellKind.Code)
            .forEach((cell) => this.createQueuedCellExecution(cell));

        try {
            await this.pendingExecution.chainExecution(async () => this.executeQueuedCells(notebookPromise, document));
        } catch (ex) {
            // Possible one cell failed, we need to stop everything else.
            traceError(`Failed to execute notebook ${document.uri.toString()}, hence cancelling all`, ex);
            await this.cancelAllCells(notebookPromise, document);
            throw ex;
        } finally {
            this.clearChainedExecutions();
            this.documentExecutions.delete(document);
            traceInfo('Restore notebook state to idle');
            await chainWithPendingUpdates(editor, (edit) =>
                edit.replaceMetadata({ ...document.metadata, runState: vscodeNotebookEnums.NotebookRunState.Idle })
            );
        }
    }
    /**
     * Interrupts the execution of cells.
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public async interrupt(document: NotebookDocument, notebookPromise?: Promise<INotebook>): Promise<InterruptResult> {
        // Possible we don't have a notebook.
        const notebook = notebookPromise ? await notebookPromise.catch(() => undefined) : undefined;
        traceInfo('Interrupt kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        const pendingCells = this.cancelAllPendingCells(document).then(() =>
            this.waitForPendingCellsToComplete(document)
        );

        if (!notebook) {
            traceInfo('No notebook to interrupt');
            this._interruptPromise = undefined;
            await pendingCells;
            return InterruptResult.Success;
        }

        // Interrupt the active execution
        const result = this._interruptPromise
            ? await this._interruptPromise
            : await (this._interruptPromise = this.interruptExecution(notebook.session, pendingCells));

        // Done interrupting, clear interrupt promise
        this._interruptPromise = undefined;

        return result;
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    private async cancelAllCells(notebookPromise: Promise<INotebook>, document: NotebookDocument): Promise<void> {
        // Ensure all chained executions are cleared, so when we start again we start fresh.
        this.clearChainedExecutions();
        // Interrupt execution of any & all cells.
        await this.interrupt(document, notebookPromise);
        // Wait for all executions to complete/stop (possible interrupt timed out).
        await this.waitForPendingCellsToComplete(document);
    }
    /**
     * Basically we should avoid caching all previous promises once we have completed a batch of execution.
     * Assume user runs a cell with invalid code or ipykernel is not installed or the like & execution fails.
     * Rectify the issue & run another cell, at this point, we should not have cached the previous execution failure.
     * Hence we should clear these after every batch of execution (when all cells run or all are stopped).
     */
    private clearChainedExecutions() {
        this.pendingExecution.clear();
        this.pendingCellExecution.clear();
    }
    /**
     * Cancel all cells that have been queued & wait for them to complete.
     * @param {boolean} [forced=false]
     * If `true`, then do not wait for cell execution to complete gracefully (just kill it).
     * This is used when we restart the kernel (either as a result of kernel interrupt or user initiated).
     * When restarted, the execution needs to stop as jupyter will not send more messages.
     * Hence `forced=true` is more like a hard kill.
     */
    private async cancelAllPendingCells(document: NotebookDocument, forced = false) {
        traceInfo('Cancel pending cells');
        // Check all cells
        const pendingCellExecutions = this.getPendingNotebookCellExecutions(document);
        await Promise.all(pendingCellExecutions.map((item) => item.cancel(forced)));
    }
    /**
     * Cancel all cells that have been queued, and if a cell has already started then wait for it to complete.
     * Basically cancel what ever hasn't started & wait for cells that have started to finish.
     * @param {boolean} [cancelPendingExecutions=false]
     * If true, then attempt to cancel all cell executions.
     */
    private async waitForPendingCellsToComplete(document: NotebookDocument) {
        traceInfo('Cancel pending cells');
        // Check all cells
        const pendingCellExecutions = this.getPendingNotebookCellExecutions(document);
        await Promise.all(pendingCellExecutions.map((item) => item.result));
    }
    private getPendingNotebookCellExecutions(document: NotebookDocument) {
        const stackOfCellsToExecute = this.stackOfCellsToExecuteByDocument.get(document);
        if (!Array.isArray(stackOfCellsToExecute) || stackOfCellsToExecute.length === 0) {
            this.stackOfCellsToExecuteByDocument.delete(document);
            return [];
        }

        return stackOfCellsToExecute
            .map((cell) => this.cellExecutions.get(cell.cell))
            .filter((item) => item !== undefined)
            .map((item) => item!);
    }
    private async interruptExecution(
        session: IJupyterSession,
        pendingCells: Promise<unknown>
    ): Promise<InterruptResult> {
        // Create a deferred promise that resolves if we have a failure
        const restarted = createDeferred<boolean>();

        // Listen to status change events so we can tell if we're restarting
        const restartHandler = (e: ServerStatus) => {
            if (e === ServerStatus.Restarting) {
                // We restarted the kernel.
                traceWarning('Kernel restarting during interrupt');

                // Indicate we restarted the race below
                restarted.resolve(true);
            }
        };
        const restartHandlerToken = session.onSessionStatusChanged(restartHandler);

        // Start our interrupt. If it fails, indicate a restart
        session.interrupt(this.interruptTimeout).catch((exc) => {
            traceWarning(`Error during interrupt: ${exc}`);
            restarted.resolve(true);
        });

        try {
            // Wait for all of the pending cells to finish or the timeout to fire
            const result = await waitForPromise(Promise.race([pendingCells, restarted.promise]), this.interruptTimeout);

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
            throw exc;
        } finally {
            restartHandlerToken.dispose();
        }
    }
    private async executeQueuedCells(notebookPromise: Promise<INotebook>, document: NotebookDocument) {
        const token = this.documentExecutions.get(document)?.token;
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === document);
        const stackOfCellsToExecute = this.stackOfCellsToExecuteByDocument.get(document);
        if (!editor || !stackOfCellsToExecute) {
            return;
        }
        const notebook = await notebookPromise;
        this.addKernelRestartHandler(document);
        stackOfCellsToExecute.forEach((exec) => traceCellMessage(exec.cell, 'Ready to execute'));
        while (stackOfCellsToExecute.length) {
            // Stack of cells to be executed, this way we maintain order of cell executions.
            const cellToExecute = stackOfCellsToExecute[0];
            if (!cellToExecute) {
                continue;
            }
            traceCellMessage(cellToExecute.cell, 'Before Execute individual cell');
            const executionResult = await this.executeIndividualCell(cellToExecute, notebook);
            traceCellMessage(cellToExecute.cell, `After Execute individual cell ${executionResult}`);
            // If a cell has failed or execution cancelled, the get out.
            if (token?.isCancellationRequested || executionResult === vscodeNotebookEnums.NotebookCellRunState.Error) {
                traceInfo(`Cancel all remaining cells ${token?.isCancellationRequested} || ${executionResult}`);
                await this.cancelAllCells(notebookPromise, document);
                break;
            }
            // Remove the item that was processed, possible it got automatically removed (see `createCellExecution`)
            if (stackOfCellsToExecute[0] === cellToExecute) {
                stackOfCellsToExecute.shift();
            }
        }
    }
    private addKernelRestartHandler(document: NotebookDocument) {
        this.getKernel(document)
            .then((kernel) => {
                if (this.kernelRestartHandlerAdded.has(kernel)) {
                    return;
                }
                traceInfo('Cancel all executions as Kernel was restarted');
                this.kernelRestartHandlerAdded.add(kernel);
                kernel.onRestarted(() => this.cancelAllPendingCells(document, true), this, this.disposables);
            })
            .catch(noop);
    }
    private createQueuedCellExecution(cell: NotebookCell) {
        if (!this.stackOfCellsToExecuteByDocument.has(cell.notebook)) {
            this.stackOfCellsToExecuteByDocument.set(cell.notebook, []);
        }
        const stackOfCellsToExecute = this.stackOfCellsToExecuteByDocument.get(cell.notebook)!;
        const cellExecution = this.executionFactory.create(cell, isPythonKernelConnection(this.metadata));
        this.cellExecutions.set(cellExecution.cell, cellExecution);
        stackOfCellsToExecute.push(cellExecution);
        cellExecution.result.finally(() => {
            // Once the cell has completed execution, remote it from the stack.
            const index = stackOfCellsToExecute.indexOf(cellExecution);
            if (index >= 0) {
                stackOfCellsToExecute.splice(index, 1);
            }
            this.cellExecutions.delete(cellExecution.cell);
        });
        traceCellMessage(cell, 'User queued cell for execution');
        return cellExecution;
    }
    private async getKernel(document: NotebookDocument): Promise<IKernel> {
        await this.validateKernel(document);
        let kernel = this.kernelProvider.get(document.uri);
        if (!kernel) {
            kernel = this.kernelProvider.getOrCreate(document.uri, { metadata: this.metadata });
        }
        if (!kernel) {
            throw new Error('Unable to create a Kernel to run cell');
        }
        await kernel.start();
        return kernel;
    }

    private async executeIndividualCell(
        cellExecution: CellExecution,
        notebook: INotebook
    ): Promise<NotebookCellRunState | undefined> {
        traceCellMessage(cellExecution.cell, 'Push cell into queue for execution');
        return this.pendingCellExecution.chainExecution(async () => {
            traceCellMessage(cellExecution.cell, 'Get cell from queue for execution');
            // Start execution
            await cellExecution.start(notebook);

            // The result promise will resolve when complete.
            const promise = cellExecution.result;
            promise
                .finally(() => {
                    traceCellMessage(cellExecution.cell, 'Cell from queue completed execution');
                })
                .catch(noop);
            return promise;
        });
    }
    private async validateKernel(document: NotebookDocument): Promise<void> {
        const kernel = this.kernelProvider.get(document.uri);
        if (!kernel) {
            return;
        }
        if (!this.kernelValidated.get(document)) {
            const promise = new Promise<void>(async (resolve) => {
                this.isRawNotebookSupported =
                    this.isRawNotebookSupported || this.rawNotebookSupported.isSupportedForLocalLaunch();
                const rawSupported = await this.isRawNotebookSupported;
                this.kernelSelectionUsage
                    .useSelectedKernel(kernel?.kernelConnectionMetadata, document.uri, rawSupported ? 'raw' : 'jupyter')
                    .finally(() => {
                        // If there's an exception, then we cannot use the kernel and a message would have been displayed.
                        // We don't want to cache such a promise, as its possible the user later installs the dependencies.
                        if (this.kernelValidated.get(document)?.kernel === kernel) {
                            this.kernelValidated.delete(document);
                        }
                    })
                    .finally(resolve)
                    .catch(noop);
            });

            this.kernelValidated.set(document, { kernel, promise });
        }
        await this.kernelValidated.get(document)!.promise;
    }
}
