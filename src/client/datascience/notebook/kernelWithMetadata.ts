// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// tslint:disable-next-line: no-require-imports
import { join } from 'path';
import { Uri } from 'vscode';
import { NotebookCell, NotebookDocument, NotebookKernel as VSCNotebookKernel } from '../../../../types/vscode-proposed';
import { IVSCodeNotebook } from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { IExtensionContext } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { getKernelConnectionId, IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { updateKernelInfoInNotebookMetadata } from './helpers/helpers';

export class VSCodeNotebookKernelMetadata implements VSCNotebookKernel {
    private pendingExecution: Promise<void> | undefined;
    get preloads(): Uri[] {
        return [
            Uri.file(join(this.context.extensionPath, 'out', 'ipywidgets', 'dist', 'ipywidgets.js')),
            Uri.file(
                join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'ipywidgetsKernel.js')
            ),
            Uri.file(join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'require.js'))
        ];
    }
    get id() {
        return getKernelConnectionId(this.selection);
    }
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly detail: string,
        public readonly selection: Readonly<KernelConnectionMetadata>,
        public readonly isPreferred: boolean,
        private readonly kernelProvider: IKernelProvider,
        private readonly notebook: IVSCodeNotebook,
        private readonly context: IExtensionContext
    ) {}
    public executeCell(doc: NotebookDocument, cell: NotebookCell) {
        traceInfo(`Execute Cell ${cell.document.uri.toString()} in kernelWithMetadata.ts`);
        const kernel = this.kernelProvider.getOrCreate(cell.notebook.uri, { metadata: this.selection });
        if (kernel) {
            this.updateKernelInfoInNotebookWhenAvailable(kernel, doc);
            return this.chainExecution(() => kernel.executeCell(cell));
        }
    }
    public executeAllCells(document: NotebookDocument) {
        const kernel = this.kernelProvider.getOrCreate(document.uri, { metadata: this.selection });
        if (kernel) {
            this.updateKernelInfoInNotebookWhenAvailable(kernel, document);
            return this.chainExecution(() => kernel.executeAllCells(document));
        }
    }
    public cancelCellExecution(_: NotebookDocument, cell: NotebookCell) {
        this.kernelProvider.get(cell.notebook.uri)?.interrupt(); // NOSONAR
    }
    public cancelAllCellsExecution(document: NotebookDocument) {
        this.kernelProvider.get(document.uri)?.interrupt(); // NOSONAR
    }
    private updateKernelInfoInNotebookWhenAvailable(kernel: IKernel, doc: NotebookDocument) {
        const disposable = kernel.onStatusChanged(() => {
            if (!kernel.info) {
                return;
            }
            const editor = this.notebook.notebookEditors.find((item) => item.document === doc);
            if (!editor || editor.kernel?.id !== this.id) {
                return;
            }
            disposable.dispose();
            updateKernelInfoInNotebookMetadata(doc, kernel.info);
        });
    }

    private chainExecution(next: () => Promise<void>): Promise<void> {
        const prev = this.pendingExecution ?? Promise.resolve();
        this.pendingExecution = prev.then(next);
        return this.pendingExecution;
    }
}
