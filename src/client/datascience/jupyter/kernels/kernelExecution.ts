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
            await this.cellExecutions.get(cell)!.result;
            return;
        }
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === cell.notebook);
        if (!editor) {
            return;
        }
        const cellExecution = this.createCellExecution(cell);
        try {
            await this.pendingExecution.chainExecution(async () =>
                this.executeQueuedCells(notebookPromise, cell.notebook)
            );
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
            return;
        }
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === document);
        if (!editor) {
            return;
        }
        this.documentExecutions.set(document, new CancellationTokenSource());

        traceInfo('Update notebook execution state as running');
        await editor.edit((edit) =>
            edit.replaceMetadata({ ...document.metadata, runState: vscodeNotebookEnums.NotebookRunState.Running })
        );
        document.cells
            .filter((cell) => cell.cellKind === vscodeNotebookEnums.CellKind.Code)
            .forEach((cell) => this.createCellExecution(cell));

        try {
            await this.pendingExecution.chainExecution(async () => this.executeQueuedCells(notebookPromise, document));
        } finally {
            this.documentExecutions.delete(document);
            traceInfo('Restore notebook state to idle');
            await editor.edit((edit) =>
                edit.replaceMetadata({ ...document.metadata, runState: vscodeNotebookEnums.NotebookRunState.Idle })
            );
        }
    }
    public async interrupt(notebookPromise: Promise<INotebook>, document: NotebookDocument): Promise<InterruptResult> {
        const notebook = await notebookPromise;
        if (!notebook) {
            traceInfo('No notebook to interrupt');
            return InterruptResult.Success;
        }
        traceInfo('Interrupt kernel execution');
        // Interrupt all the cells, & wait for all to complete.
        const cellExecutionPromises = this.waitForAllQueuedCells(document, true);

        // Interrupt the active execution
        const result = this._interruptPromise
            ? await this._interruptPromise
            : await (this._interruptPromise = this.interruptExecution(notebook.session, cellExecutionPromises));

        // Done interrupting, clear interrupt promise
        this._interruptPromise = undefined;

        return result;
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    private async cancelAllCells(notebookPromise: Promise<INotebook>, document: NotebookDocument): Promise<void> {
        await this.interrupt(notebookPromise, document);
        await this.waitForAllQueuedCells(document);
    }

    private async waitForAllQueuedCells(document: NotebookDocument, interrupt = false) {
        traceInfo('Interrupt kernel execution');
        const stackOfCellsToExecute = this.stackOfCellsToExecuteByDocument.get(document);
        if (!Array.isArray(stackOfCellsToExecute) || stackOfCellsToExecute.length === 0) {
            this.stackOfCellsToExecuteByDocument.delete(document);
            // No pending cells.
            return;
        }

        traceInfo('Cancel document execution');
        // Check all cells
        const cellsToCancel = new Set([...document.cells, ...stackOfCellsToExecute.map((item) => item.cell)]);
        const cellExecutions = Array.from(cellsToCancel)
            .map((cell) => this.cellExecutions.get(cell))
            .filter((item) => item !== undefined)
            .map((item) => item!);

        // Wait for all to complete.
        await Promise.all(
            cellExecutions.map(async (item) => {
                if (interrupt) {
                    await item.interrupt();
                } else {
                    await item.result;
                }
                // Once completed, remove the cell from the list of executions.
                const index = stackOfCellsToExecute.indexOf(item);
                if (index >= 0) {
                    stackOfCellsToExecute.splice(index, 1);
                }
            })
        );
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
        try {
            const notebook = await notebookPromise;
            const kernel = this.getKernel(document);
            stackOfCellsToExecute.forEach((exec) => traceCellMessage(exec.cell, 'Ready to execute'));
            while (stackOfCellsToExecute.length) {
                // Stack of cells to be executed, this way we maintain order of cell executions.
                const cellToExecute = stackOfCellsToExecute[0];
                if (!cellToExecute) {
                    continue;
                }
                traceCellMessage(cellToExecute.cell, 'Before Execute individual cell');
                const result = this.executeIndividualCell(kernel, cellToExecute, notebook);
                result.finally(() => this.cellExecutions.delete(cellToExecute.cell)).catch(noop);
                const executionResult = await result;
                traceCellMessage(cellToExecute.cell, `After Execute individual cell ${executionResult}`);
                // If a cell has failed or execution cancelled, the get out.
                if (
                    token?.isCancellationRequested ||
                    executionResult === vscodeNotebookEnums.NotebookCellRunState.Error
                ) {
                    traceInfo(`Cancel all remaining cells ${token?.isCancellationRequested} || ${executionResult}`);
                    await this.cancelAllCells(notebookPromise, document);
                    break;
                }
                // Remove the item that was processed.
                stackOfCellsToExecute.shift();
            }
        } catch (ex) {
            traceError('Failed to execute cells', ex);
            await this.cancelAllCells(notebookPromise, document);
            throw ex;
        }
    }
    private createCellExecution(cell: NotebookCell) {
        const stackOfCellsToExecute = this.stackOfCellsToExecuteByDocument.get(cell.notebook) || [];
        if (!this.stackOfCellsToExecuteByDocument.has(cell.notebook)) {
            this.stackOfCellsToExecuteByDocument.set(cell.notebook, stackOfCellsToExecute);
        }
        const cellExecution = this.executionFactory.create(cell, isPythonKernelConnection(this.metadata));
        this.cellExecutions.set(cellExecution.cell, cellExecution);
        stackOfCellsToExecute.push(cellExecution);
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
        kernelPromise: Promise<IKernel>,
        cellExecution: CellExecution,
        notebook: INotebook
    ): Promise<NotebookCellRunState | undefined> {
        return this.pendingCellExecution.chainExecution(async () => {
            // Start execution
            await cellExecution.start(kernelPromise, notebook);

            // The result promise will resolve when complete.
            return cellExecution.result;
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
