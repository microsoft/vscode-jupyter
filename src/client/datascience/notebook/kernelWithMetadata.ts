// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { join } from 'path';
import { Uri } from 'vscode';
import { NotebookCell, NotebookDocument, NotebookKernel as VSCNotebookKernel } from '../../../../types/vscode-proposed';
import { IVSCodeNotebook } from '../../common/application/types';
import { disposeAllDisposables } from '../../common/helpers';
import { traceInfo } from '../../common/logger';
import { IDisposable, IExtensionContext } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import { getKernelConnectionId, IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { KernelSocketInformation } from '../types';
import { updateKernelInfoInNotebookMetadata } from './helpers/helpers';
import { INotebookKernelProvider } from './types';

export class VSCodeNotebookKernelMetadata implements VSCNotebookKernel {
    private pendingExecution: Promise<void> | undefined;
    get preloads(): Uri[] {
        return [
            Uri.file(join(this.context.extensionPath, 'out', 'ipywidgets', 'dist', 'ipywidgets.js')),
            Uri.file(
                join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'ipywidgetsKernel.js')
            ),
            Uri.file(
                join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'fontAwesomeLoader.js')
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
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        private readonly notebookKernelProvider: INotebookKernelProvider
    ) {
        this.notebookKernelProvider.onDidGetFontAwesomeMessage((e) => {
            if (e.message.type === InteractiveWindowMessages.GetFontAwesomeUriRequest) {
                void e.webview.postMessage({
                    type: InteractiveWindowMessages.GetFontAwesomeUriResponse,
                    payload: e.webview.asWebviewUri(
                        Uri.file(
                            join(
                                this.context.extensionPath,
                                'out',
                                'datascience-ui',
                                'notebook',
                                'node_modules',
                                'font-awesome',
                                'css',
                                'font-awesome.min.css'
                            )
                        )
                    )
                });
            }
        });
    }
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
            updateKernelInfoInNotebookMetadata(doc, kernel.info);
            if (kernel.info.status === 'ok' && this.selection.kind === 'startUsingKernelSpec') {
                saveKernelInfo();
            }
        });

        handlerDisposables.push({ dispose: () => subscriptionDisposables.unsubscribe() });
        handlerDisposables.push({ dispose: () => statusChangeDisposable.dispose() });
        handlerDisposables.push({ dispose: () => kernelDisposedDisposable?.dispose() });
    }

    private async chainExecution(next: () => Promise<void>): Promise<void> {
        if (this.pendingExecution) {
            try {
                await this.pendingExecution;
            } catch (e) {
                // Errors are handled elsewhere
                traceInfo(`Kernel execution previous failure: ${e}`);
            }
        }
        this.pendingExecution = next();
        return this.pendingExecution;
    }
}
