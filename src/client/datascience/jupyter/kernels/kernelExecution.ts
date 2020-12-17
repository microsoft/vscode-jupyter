// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { NotebookCell, NotebookCellRunState, NotebookDocument } from 'vscode';

import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import { traceInfo } from '../../../common/logger';
import { IDisposable, IExtensionContext } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { captureTelemetry } from '../../../telemetry';
import { Commands, Telemetry, VSCodeNativeTelemetry } from '../../constants';
import { traceCellMessage } from '../../notebook/helpers/helpers';
import { MultiCancellationTokenSource } from '../../notebook/helpers/multiCancellationToken';
import {
    IDataScienceErrorHandler,
    INotebook,
    INotebookEditorProvider,
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
    public notebook?: INotebook;

    private readonly cellExecutions = new WeakMap<NotebookCell, CellExecution>();

    private readonly documentExecutions = new WeakMap<NotebookDocument, MultiCancellationTokenSource>();

    private readonly kernelValidated = new WeakMap<NotebookDocument, { kernel: IKernel; promise: Promise<void> }>();

    private readonly executionFactory: CellExecutionFactory;
    private readonly disposables: IDisposable[] = [];
    private isRawNotebookSupported?: Promise<boolean>;
    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly commandManager: ICommandManager,
        errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        readonly kernelSelectionUsage: IKernelSelectionUsage,
        readonly appShell: IApplicationShell,
        readonly vscNotebook: IVSCodeNotebook,
        readonly metadata: Readonly<KernelConnectionMetadata>,
        private readonly rawNotebookSupported: IRawNotebookSupportedService,
        context: IExtensionContext
    ) {
        this.executionFactory = new CellExecutionFactory(errorHandler, editorProvider, appShell, vscNotebook, context);
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    public async executeCell(cell: NotebookCell): Promise<void> {
        if (!this.notebook) {
            throw new Error('executeObservable cannot be called if kernel has not been started!');
        }
        // Cannot execute empty cells.
        if (this.cellExecutions.has(cell) || cell.document.getText().trim().length === 0) {
            return;
        }
        const cellExecution = this.executionFactory.create(cell, isPythonKernelConnection(this.metadata));
        this.cellExecutions.set(cell, cellExecution);

        const kernel = this.getKernel(cell.notebook);

        try {
            traceCellMessage(cell, 'executeCell started in KernelExecution');
            await this.executeIndividualCell(kernel, cellExecution);
        } finally {
            traceCellMessage(cell, 'executeCell completed in KernelExecution');
            this.cellExecutions.delete(cell);
        }
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    @captureTelemetry(VSCodeNativeTelemetry.RunAllCells, undefined, true)
    public async executeAllCells(document: NotebookDocument): Promise<void> {
        if (!this.notebook) {
            throw new Error('executeObservable cannot be called if kernel has not been started!');
        }
        if (this.documentExecutions.has(document)) {
            return;
        }
        const editor = this.vscNotebook.notebookEditors.find((item) => item.document === document);
        if (!editor) {
            return;
        }
        const cancelTokenSource = new MultiCancellationTokenSource();
        this.documentExecutions.set(document, cancelTokenSource);
        const kernel = this.getKernel(document);

        traceInfo('Update notebook execution state as running');
        await editor.edit((edit) =>
            edit.replaceMetadata({ ...document.metadata, runState: vscodeNotebookEnums.NotebookRunState.Running })
        );
        const codeCellsToExecute = document.cells
            .filter((cell) => cell.cellKind === vscodeNotebookEnums.CellKind.Code)
            .filter((cell) => cell.document.getText().trim().length > 0)
            .map((cell) => {
                const cellExecution = this.executionFactory.create(cell, isPythonKernelConnection(this.metadata));
                this.cellExecutions.set(cellExecution.cell, cellExecution);
                return cellExecution;
            });
        cancelTokenSource.token.onCancellationRequested(
            () => codeCellsToExecute.forEach((cell) => cell.cancel()),
            this,
            this.disposables
        );

        try {
            codeCellsToExecute.forEach((exec) => traceCellMessage(exec.cell, 'Ready to execute'));
            for (const cellToExecute of codeCellsToExecute) {
                traceCellMessage(cellToExecute.cell, 'Before Execute individual cell');
                const result = this.executeIndividualCell(kernel, cellToExecute);
                result.finally(() => this.cellExecutions.delete(cellToExecute.cell)).catch(noop);
                const executionResult = await result;
                traceCellMessage(cellToExecute.cell, `After Execute individual cell ${executionResult}`);
                // If a cell has failed or execution cancelled, the get out.
                if (
                    cancelTokenSource.token.isCancellationRequested ||
                    executionResult === vscodeNotebookEnums.NotebookCellRunState.Error
                ) {
                    traceInfo(
                        `Cancel all remaining cells ${cancelTokenSource.token.isCancellationRequested} || ${executionResult}`
                    );
                    await Promise.all(codeCellsToExecute.map((cell) => cell.cancel())); // Cancel pending cells.
                    break;
                }
            }
        } finally {
            traceInfo(`Cancel all remaining cells after finally`);
            await Promise.all(codeCellsToExecute.map((cell) => cell.cancel())); // Cancel pending cells.
            this.documentExecutions.delete(document);
            traceInfo('Restore notebook state to idle');
            await editor.edit((edit) =>
                edit.replaceMetadata({ ...document.metadata, runState: vscodeNotebookEnums.NotebookRunState.Idle })
            );
        }
    }

    public async cancelCell(cell: NotebookCell) {
        if (this.cellExecutions.get(cell)) {
            traceCellMessage(cell, 'Cancel cell from Kernel Execution');
            await this.cellExecutions.get(cell)!.cancel();
        } else {
            traceCellMessage(cell, 'Cannot cancel cell execution from Kernel Execution');
        }
    }

    public cancelAllCells(document: NotebookDocument): void {
        if (this.documentExecutions.get(document)) {
            this.documentExecutions.get(document)!.cancel();
        }
        traceInfo('Cancel document execution');
        document.cells.forEach((cell) => this.cancelCell(cell));
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
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
        cellExecution: CellExecution
    ): Promise<NotebookCellRunState | undefined> {
        if (!this.notebook) {
            throw new Error('No notebook object');
        }

        cellExecution.token.onCancellationRequested(
            // Interrupt kernel only if we need to cancel a cell execution.
            () => {
                traceCellMessage(cellExecution.cell, 'Cell cancellation requested');
                this.commandManager.executeCommand(Commands.NotebookEditorInterruptKernel).then(noop, noop);
            },
            this,
            this.disposables
        );

        // Start execution
        await cellExecution.start(kernelPromise, this.notebook);

        // The result promise will resolve when complete.
        return cellExecution.result;
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
                    .useSelectedKernel(kernel?.metadata, document.uri, rawSupported ? 'raw' : 'jupyter')
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
