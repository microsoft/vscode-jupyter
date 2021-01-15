// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { join } from 'path';
import { Uri } from 'vscode';
import { NotebookCell, NotebookDocument, NotebookKernel as VSCNotebookKernel } from '../../../../types/vscode-proposed';
import { IVSCodeNotebook } from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { IDisposable, IExtensionContext } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { getKernelConnectionId, IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { updateKernelInfoInNotebookMetadata } from './helpers/helpers';

export class VSCodeNotebookKernelMetadata implements VSCNotebookKernel {
    private pendingExecution: Promise<void> | undefined;
    get preloads(): Uri[] {
        return [
            Uri.file(join(this.context.extensionPath, 'out', 'ipywidgets', 'dist', 'ipywidgets.js')),
            Uri.file(
                join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'ipywidgetsKernel.js')
            )
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
        private readonly context: IExtensionContext,
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider
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
        this.kernelProvider.get(cell.notebook.uri)?.interruptCell(cell).ignoreErrors(); // NOSONAR
    }
    public cancelAllCellsExecution(document: NotebookDocument) {
        this.kernelProvider.get(document.uri)?.interruptAllCells(document).ignoreErrors(); // NOSONAR
    }
    private updateKernelInfoInNotebookWhenAvailable(kernel: IKernel, doc: NotebookDocument) {
        let disposeHandler: IDisposable | undefined;
        const disposable = kernel.onStatusChanged(() => {
            if (kernel.disposed || !kernel.info) {
                return;
            }
            const editor = this.notebook.notebookEditors.find((item) => item.document === doc);
            if (!editor || editor.kernel?.id !== this.id) {
                return;
            }
            disposable.dispose();
            if (disposeHandler) {
                disposeHandler.dispose();
            }
            updateKernelInfoInNotebookMetadata(doc, kernel.info);

            if (kernel.info.status === 'ok' && this.selection.kind === 'connectToLiveKernel') {
                traceInfo(`Updating preferred kernel for remote notebook`);
                this.preferredRemoteKernelIdProvider
                    .storePreferredRemoteKernelId(doc.uri, this.selection.kernelModel.id)
                    .catch(noop);
            }
        });
        disposeHandler = kernel.onDisposed(() => {
            if (disposeHandler) {
                disposeHandler.dispose();
            }
            disposable.dispose();
        });
    }

    private chainExecution(next: () => Promise<void>): Promise<void> {
        const prev = this.pendingExecution ?? Promise.resolve();
        this.pendingExecution = prev.then(next);
        return this.pendingExecution;
    }
}
