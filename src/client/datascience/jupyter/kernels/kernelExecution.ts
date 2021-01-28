// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { NotebookCell, NotebookDocument, NotebookEditor } from 'vscode';
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell, IVSCodeNotebook } from '../../../common/application/types';
import { traceInfo, traceWarning } from '../../../common/logger';
import { IDisposable, IExtensionContext } from '../../../common/types';
import { createDeferred, waitForPromise } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { captureTelemetry } from '../../../telemetry';
import { Telemetry, VSCodeNativeTelemetry } from '../../constants';
import { chainWithPendingUpdates } from '../../notebook/helpers/notebookUpdater';
import {
    IDataScienceErrorHandler,
    IJupyterSession,
    INotebook,
    INotebookEditorProvider,
    InterruptResult,
    IRawNotebookSupportedService
} from '../../types';
import { CellExecutionFactory } from './cellExecution';
import { CellExecutionStack } from './cellExecutionStack';
import { isPythonKernelConnection } from './helpers';
import type { IKernel, IKernelProvider, IKernelSelectionUsage, KernelConnectionMetadata } from './types';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

/**
 * Separate class that deals just with kernel execution.
 * Else the `Kernel` class gets very big.
 */
export class KernelExecution implements IDisposable {
    private readonly documentExecutions = new WeakMap<NotebookDocument, CellExecutionStack>();
    private readonly kernelValidated = new WeakMap<NotebookDocument, { kernel: IKernel; promise: Promise<void> }>();

    private readonly executionFactory: CellExecutionFactory;
    private readonly disposables: IDisposable[] = [];
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
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === cell.notebook);
        if (!editor) {
            // No editor, possible it was closed.
            return;
        }
        const executionStack = this.getOrCreateCellExecutionStack(editor, notebookPromise);
        await executionStack.runCell(cell);
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    @captureTelemetry(VSCodeNativeTelemetry.RunAllCells, undefined, true)
    public async executeAllCells(notebookPromise: Promise<INotebook>, document: NotebookDocument): Promise<void> {
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === document);
        if (!editor) {
            // No editor, possible it was closed.
            return;
        }
        const executionStack = this.getOrCreateCellExecutionStack(editor, notebookPromise);

        try {
            traceInfo('Update notebook execution state as running');

            const updateNotebookStatus = chainWithPendingUpdates(executionStack.editor, (edit) =>
                edit.replaceMetadata({
                    ...document.metadata,
                    runState: vscodeNotebookEnums.NotebookRunState.Running
                })
            );
            const runAllCells = executionStack.runAllCells();

            await Promise.all([updateNotebookStatus, runAllCells]);
        } finally {
            traceInfo('Restore notebook state to idle');
            await chainWithPendingUpdates(executionStack.editor, (edit) =>
                edit.replaceMetadata({ ...document.metadata, runState: vscodeNotebookEnums.NotebookRunState.Idle })
            );
        }
    }
    /**
     * Interrupts the execution of cells.
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public async interrupt(document: NotebookDocument, notebookPromise?: Promise<INotebook>): Promise<InterruptResult> {
        const executionStack = this.documentExecutions.get(document);
        if (!executionStack) {
            return InterruptResult.Success;
        }
        // Possible we don't have a notebook.
        const notebook = notebookPromise ? await notebookPromise.catch(() => undefined) : undefined;
        traceInfo('Interrupt kernel execution');
        // First cancel all the cells & then wait for them to complete.
        // Both must happen together, we cannot just wait for cells to complete, as its possible
        // that cell1 has started & cell2 has been queued. If Cell1 completes, then Cell2 will start.
        // What we want is, if Cell1 completes then Cell2 should not start (it must be cancelled before hand).
        const pendingCells = executionStack.cancel().then(() => executionStack.waitForCompletion());

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
    private getOrCreateCellExecutionStack(editor: NotebookEditor, notebookPromise: Promise<INotebook>) {
        const existingExecutionStack = this.documentExecutions.get(editor.document);
        // If it has not yet completed, re-use the existing stack.
        if (existingExecutionStack && !existingExecutionStack.completed) {
            existingExecutionStack;
        }

        // If it has not completed then wait for it to complete & create a new execution stack.
        let waitUntilPreviousExecutionCompletes = Promise.resolve();
        if (existingExecutionStack && existingExecutionStack.completed) {
            // This is required, so that the new stack is read & we start queueing the cells into that.
            // Else if user runs another cell, then we get into this method yet again & both of the cells
            // are now waiting for previous execution to complete & its possible
            // we end up with those two cells creating their own execution stacks.
            // This way, we create a new execution stack & the queue the two new cells in the order the user ran.

            // One way this happens is,
            // User hits cancel, and then user runs another cell.
            // If the previous cancellation completes & `completed = true`, then
            // we need to wait for it to finish everything before we start the other execution.
            // Else we could have cell states being updated by the two stacks in correctly.
            waitUntilPreviousExecutionCompletes = existingExecutionStack.waitForCompletion().catch(noop);
        }

        const wrappedNotebookPromise = this.getKernel(editor.document)
            .then((kernel) => this.addKernelRestartHandler(kernel, editor.document))
            .then(() => notebookPromise);

        const newCellExecutionStack = new CellExecutionStack(
            waitUntilPreviousExecutionCompletes,
            editor,
            wrappedNotebookPromise,
            this.executionFactory,
            isPythonKernelConnection(this.metadata)
        );

        this.documentExecutions.set(editor.document, newCellExecutionStack);
        return newCellExecutionStack;
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
    private addKernelRestartHandler(kernel: IKernel, document: NotebookDocument) {
        if (this.kernelRestartHandlerAdded.has(kernel)) {
            return;
        }
        this.kernelRestartHandlerAdded.add(kernel);
        traceInfo('Hooked up kernel restart handler');
        kernel.onRestarted(
            () => {
                // We're only interested in restarts of the kernel associated with this document.
                const executionStack = this.documentExecutions.get(document);
                if (kernel !== this.kernelProvider.get(document.uri) || !executionStack) {
                    return;
                }

                traceInfo('Cancel all executions as Kernel was restarted');
                return executionStack.cancel(true);
            },
            this,
            this.disposables
        );
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
