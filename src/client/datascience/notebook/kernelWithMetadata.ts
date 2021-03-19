// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { join } from 'path';
import { Uri, NotebookCell, NotebookDocument, NotebookKernel as VSCNotebookKernel, NotebookCellRange, NotebookCellKind } from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { disposeAllDisposables } from '../../common/helpers';
import { traceInfo } from '../../common/logger';
import { IDisposable, IExtensionContext } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { Commands } from '../constants';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { KernelSocketInformation } from '../types';
import { traceCellMessage, trackKernelInfoInNotebookMetadata } from './helpers/helpers';

export class VSCodeNotebookKernelMetadata implements VSCNotebookKernel {
    private notebookKernels = new WeakMap<NotebookDocument, IKernel>();
    get preloads(): Uri[] {
        return [
            Uri.file(join(this.context.extensionPath, 'out', 'ipywidgets', 'dist', 'ipywidgets.js')),
            Uri.file(
                join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'ipywidgetsKernel.js')
            ),
            Uri.file(join(this.context.extensionPath, 'out', 'datascience-ui', 'notebook', 'fontAwesomeLoader.js'))
        ];
    }
    get id() {
        return this.selection.id;
    }
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly detail: string,
        public readonly selection: Readonly<KernelConnectionMetadata>,
        public readonly isPreferred: boolean,
        private readonly kernelProvider: IKernelProvider,
        private readonly notebook: IVSCodeNotebook,
        private readonly context: IExtensionContext,
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        private readonly commandManager: ICommandManager
    ) { }
    public interrupt(document: NotebookDocument, ranges: NotebookCellRange[]) {
        document.cells
            .filter((cell) => ranges.some((range) => range.start >= cell.index && range.end < cell.index))
            .forEach((cell) => traceCellMessage(cell, 'Cell cancellation requested'));
        this.commandManager.executeCommand(Commands.NotebookEditorInterruptKernel).then(noop, noop);
    }

    /**
     * Called when the user triggers execution of a cell by clicking the run button for a cell, multiple cells,
     * or full notebook. The cell will be put into the Pending state when this method is called. If
     * createNotebookCellExecutionTask has not been called by the time the promise returned by this method is
     * resolved, the cell will be put back into the Idle state.
     */
    public async executeCellsRequest(document: NotebookDocument, ranges: NotebookCellRange[]): Promise<void> {
        const cells = document.cells.filter((cell) =>
            cell.kind === NotebookCellKind.Code && ranges.some((range) => range.start <= cell.index && cell.index < range.end)
        );

        await cells.map((cell) => this.executeCell(document, cell));
    }

    private executeCell(doc: NotebookDocument, cell: NotebookCell) {
        traceInfo(`Execute Cell ${cell.index} ${cell.notebook.uri.toString()} in kernelWithMetadata.ts`);
        const kernel = this.kernelProvider.getOrCreate(cell.notebook.uri, { metadata: this.selection });
        if (kernel) {
            this.updateKernelInfoInNotebookWhenAvailable(kernel, doc);
            return kernel.executeCell(cell);
        }
    }
    private updateKernelInfoInNotebookWhenAvailable(kernel: IKernel, doc: NotebookDocument) {
        if (this.notebookKernels.get(doc) === kernel) {
            return;
        }
        this.notebookKernels.set(doc, kernel);
        let kernelSocket: KernelSocketInformation | undefined;
        const handlerDisposables: IDisposable[] = [];
        // If the notebook is closed, dispose everything.
        notebook.onDidCloseNotebookDocument(
            (e) => {
                if (e === doc) {
                    disposeAllDisposables(handlerDisposables);
                }
            },
            this,
            handlerDisposables
        );
        const saveKernelInfo = () => {
            const kernelId = kernelSocket?.options.id;
            if (!kernelId) {
                return;
            }
            traceInfo(`Updating preferred kernel for remote notebook ${kernelId}`);
            this.preferredRemoteKernelIdProvider.storePreferredRemoteKernelId(doc.uri, kernelId).catch(noop);
        };

        const kernelDisposedDisposable = kernel.onDisposed(() => disposeAllDisposables(handlerDisposables));
        const subscriptionDisposables = kernel.kernelSocket.subscribe((item) => {
            kernelSocket = item;
            saveKernelInfo();
        });
        const statusChangeDisposable = kernel.onStatusChanged(() => {
            if (kernel.disposed || !kernel.info) {
                return;
            }
            const editor = this.notebook.notebookEditors.find((item) => item.document === doc);
            if (!editor || editor.kernel?.id !== this.id) {
                return;
            }
            trackKernelInfoInNotebookMetadata(doc, kernel.info);
            if (this.selection.kind === 'startUsingKernelSpec') {
                if (kernel.info.status === 'ok') {
                    saveKernelInfo();
                } else {
                    disposeAllDisposables(handlerDisposables);
                }
            } else {
                disposeAllDisposables(handlerDisposables);
            }
        });

        handlerDisposables.push({ dispose: () => subscriptionDisposables.unsubscribe() });
        handlerDisposables.push({ dispose: () => statusChangeDisposable.dispose() });
        handlerDisposables.push({ dispose: () => kernelDisposedDisposable?.dispose() });
    }
}
