// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { join } from 'path';
import { Uri, NotebookCell, NotebookDocument, NotebookKernel as VSCNotebookKernel } from 'vscode';
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
    ) {}
    public executeCell(doc: NotebookDocument, cell: NotebookCell) {
        traceInfo(`Execute Cell ${cell.index} ${cell.notebook.uri.toString()} in kernelWithMetadata.ts`);
        const kernel = this.kernelProvider.getOrCreate(cell.notebook.uri, { metadata: this.selection });
        if (kernel) {
            this.updateKernelInfoInNotebookWhenAvailable(kernel, doc);
            return kernel.executeCell(cell);
        }
    }
    public executeAllCells(document: NotebookDocument) {
        const kernel = this.kernelProvider.getOrCreate(document.uri, { metadata: this.selection });
        if (kernel) {
            this.updateKernelInfoInNotebookWhenAvailable(kernel, document);
            return kernel.executeAllCells(document);
        }
    }
    public cancelCellExecution(_: NotebookDocument, cell: NotebookCell) {
        traceCellMessage(cell, 'Cell cancellation requested');
        this.commandManager.executeCommand(Commands.NotebookEditorInterruptKernel).then(noop, noop);
    }
    public cancelAllCellsExecution(document: NotebookDocument) {
        traceInfo(`Document cancellation requested ${document.uri}`);
        this.commandManager.executeCommand(Commands.NotebookEditorInterruptKernel).then(noop, noop);
    }
    private updateKernelInfoInNotebookWhenAvailable(kernel: IKernel, doc: NotebookDocument) {
        let kernelSocket: KernelSocketInformation | undefined;
        const handlerDisposables: IDisposable[] = [];

        const saveKernelInfo = () => {
            const kernelId = kernelSocket?.options.id;
            if (!kernelId) {
                return;
            }
            traceInfo(`Updating preferred kernel for remote notebook ${kernelId}`);
            this.preferredRemoteKernelIdProvider.storePreferredRemoteKernelId(doc.uri, kernelId).catch(noop);

            disposeAllDisposables(handlerDisposables);
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
            if (kernel.info.status === 'ok' && this.selection.kind === 'startUsingKernelSpec') {
                saveKernelInfo();
            }
        });

        handlerDisposables.push({ dispose: () => subscriptionDisposables.unsubscribe() });
        handlerDisposables.push({ dispose: () => statusChangeDisposable.dispose() });
        handlerDisposables.push({ dispose: () => kernelDisposedDisposable?.dispose() });
    }
}
