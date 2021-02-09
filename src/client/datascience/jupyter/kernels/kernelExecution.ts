// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { NotebookCell, NotebookDocument, NotebookEditor } from 'vscode';
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell, IVSCodeNotebook } from '../../../common/application/types';
import { traceInfo, traceWarning } from '../../../common/logger';
import { IDisposable, IExtensionContext } from '../../../common/types';
import { createDeferred, waitForPromise } from '../../../common/utils/async';
import { StopWatch } from '../../../common/utils/stopWatch';
import { captureTelemetry } from '../../../telemetry';
import { Telemetry, VSCodeNativeTelemetry } from '../../constants';
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../../context/telemetry';
import { traceCellMessage } from '../../notebook/helpers/helpers';
import { chainWithPendingUpdates } from '../../notebook/helpers/notebookUpdater';
import {
    IDataScienceErrorHandler,
    IJupyterSession,
    INotebook,
    INotebookEditorProvider,
    InterruptResult
} from '../../types';
import { CellExecutionFactory } from './cellExecution';
import { CellExecutionQueue } from './cellExecutionQueue';
import { isPythonKernelConnection } from './helpers';
import type { IKernel, IKernelProvider, IKernelSelectionUsage, KernelConnectionMetadata } from './types';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

/**
 * Separate class that deals just with kernel execution.
 * Else the `Kernel` class gets very big.
 */
export class KernelExecution implements IDisposable {
    private readonly documentExecutions = new WeakMap<NotebookDocument, CellExecutionQueue>();
    private readonly executionFactory: CellExecutionFactory;
    private readonly disposables: IDisposable[] = [];
    private readonly kernelRestartHandlerAdded = new WeakSet<IKernel>();
    private _interruptPromise?: Promise<InterruptResult>;
    constructor(
        private readonly kernelProvider: IKernelProvider,
        errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        readonly kernelSelectionUsage: IKernelSelectionUsage,
        appShell: IApplicationShell,
        readonly vscNotebook: IVSCodeNotebook,
        readonly metadata: Readonly<KernelConnectionMetadata>,
        context: IExtensionContext,
        private readonly interruptTimeout: number
    ) {
        this.executionFactory = new CellExecutionFactory(errorHandler, editorProvider, appShell, vscNotebook, context);
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    public async executeCell(notebookPromise: Promise<INotebook>, cell: NotebookCell): Promise<void> {
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === cell.notebook);
        if (!editor) {
            // No editor, possible it was closed.
            return;
        }
        if (cell.metadata.runState === vscodeNotebookEnums.NotebookCellRunState.Running) {
            // This is an unlikely scenario (UI doesn't allow this).
            // Seen something similar in CI tests when we manually run whole document using the commands.
            traceCellMessage(cell, 'Cell is already running, somehow executeCell called again');
            return;
        }

        const executionQueue = this.getOrCreateCellExecutionQueue(editor, notebookPromise);
        executionQueue.queueCell(cell);
        await executionQueue.waitForCompletion([cell]);
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    @captureTelemetry(VSCodeNativeTelemetry.RunAllCells, undefined, true)
    public async executeAllCells(notebookPromise: Promise<INotebook>, document: NotebookDocument): Promise<void> {
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === document);
        if (!editor) {
            // No editor, possible it was closed.
            return;
        }

        // Only run code cells that are not already running.
        const cellsThatWeCanRun = editor.document.cells
            .filter((cell) => cell.cellKind === vscodeNotebookEnums.CellKind.Code)
            .filter((cell) => cell.metadata.runState !== vscodeNotebookEnums.NotebookCellRunState.Running);
        if (cellsThatWeCanRun.length === 0) {
            // This is an unlikely scenario (UI doesn't allow this).
            // Seen this in CI tests when we manually run whole document using the commands.
            return;
        }

        const executionQueue = this.getOrCreateCellExecutionQueue(editor, notebookPromise);

        try {
            traceInfo('Update notebook execution state as running');

            const updateNotebookStatus = chainWithPendingUpdates(editor, (edit) =>
                edit.replaceMetadata({
                    ...document.metadata,
                    runState: vscodeNotebookEnums.NotebookRunState.Running
                })
            );
            cellsThatWeCanRun.forEach((cell) => executionQueue.queueCell(cell));
            const runAllCells = executionQueue.waitForCompletion(cellsThatWeCanRun);

            await Promise.all([updateNotebookStatus, runAllCells]);
        } finally {
            traceInfo('Restore notebook state to idle after completion');
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
        trackKernelResourceInformation(document.uri, { interruptKernel: true });
        const executionQueue = this.documentExecutions.get(document);
        if (!executionQueue) {
            return InterruptResult.Success;
        }
        // Possible we don't have a notebook.
        const notebook = notebookPromise ? await notebookPromise.catch(() => undefined) : undefined;
        traceInfo('Interrupt kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        const pendingCells = executionQueue.cancel().then(() => executionQueue.waitForCompletion());

        if (!notebook) {
            traceInfo('No notebook to interrupt');
            this._interruptPromise = undefined;
            await pendingCells;
            return InterruptResult.Success;
        }

        // Interrupt the active execution
        const result = this._interruptPromise
            ? await this._interruptPromise
            : await (this._interruptPromise = this.interruptExecution(document, notebook.session, pendingCells));

        // Done interrupting, clear interrupt promise
        this._interruptPromise = undefined;

        return result;
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    private getOrCreateCellExecutionQueue(editor: NotebookEditor, notebookPromise: Promise<INotebook>) {
        const existingExecutionQueue = this.documentExecutions.get(editor.document);
        // Re-use the existing Queue if it can be used.
        if (existingExecutionQueue && !existingExecutionQueue.isEmpty && !existingExecutionQueue.failed) {
            return existingExecutionQueue;
        }

        // We need to add the handler to kernel immediately (before we resolve the notebook, else its possible user hits restart or the like and we miss that event).
        const wrappedNotebookPromise = this.getKernel(editor.document)
            .then((kernel) => this.addKernelRestartHandler(kernel, editor.document))
            .then(() => notebookPromise);

        const newCellExecutionQueue = new CellExecutionQueue(
            wrappedNotebookPromise,
            this.executionFactory,
            isPythonKernelConnection(this.metadata)
        );

        // If the editor is closed (user or on CI), then just stop handling the UI updates.
        editor.onDidDispose(
            async () => {
                if (!newCellExecutionQueue.failed || !newCellExecutionQueue.isEmpty) {
                    await newCellExecutionQueue.cancel(true);
                }
            },
            this,
            this.disposables
        );

        this.documentExecutions.set(editor.document, newCellExecutionQueue);
        return newCellExecutionQueue;
    }
    @captureTelemetry(Telemetry.Interrupt)
    @captureTelemetry(Telemetry.InterruptJupyterTime)
    private async interruptExecution(
        document: NotebookDocument,
        session: IJupyterSession,
        pendingCells: Promise<unknown>
    ): Promise<InterruptResult> {
        const restarted = createDeferred<boolean>();
        const stopWatch = new StopWatch();
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
                    document.uri,
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
            sendKernelTelemetryEvent(document.uri, Telemetry.NotebookInterrupt, stopWatch.elapsedTime, { result });
            return result;
        });
    }
    private addKernelRestartHandler(kernel: IKernel, document: NotebookDocument) {
        if (this.kernelRestartHandlerAdded.has(kernel)) {
            return;
        }
        this.kernelRestartHandlerAdded.add(kernel);
        traceInfo('Hooked up kernel restart handler');
        kernel.onRestarted(
            () => {
                // We're only interested in restarts of the kernel associated with this document.
                const executionQueue = this.documentExecutions.get(document);
                if (kernel !== this.kernelProvider.get(document.uri) || !executionQueue) {
                    return;
                }

                traceInfo('Cancel all executions as Kernel was restarted');
                return executionQueue.cancel(true);
            },
            this,
            this.disposables
        );
    }
    private async getKernel(document: NotebookDocument): Promise<IKernel> {
        let kernel = this.kernelProvider.get(document.uri);
        if (!kernel) {
            kernel = this.kernelProvider.getOrCreate(document.uri, { metadata: this.metadata });
        }
        if (!kernel) {
            throw new Error('Unable to create a Kernel to run cell');
        }
        await kernel.start({ document });
        return kernel;
    }
}
