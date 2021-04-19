// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable, NotebookCell, NotebookController, NotebookDocument, NotebookSelector } from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { disposeAllDisposables } from '../../common/helpers';
import { traceInfo } from '../../common/logger';
import { IDisposable } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { Commands } from '../constants';
import { getDescriptionOfKernelConnection, getDisplayNameOrNameOfKernelConnection } from '../jupyter/kernels/helpers';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { KernelSocketInformation } from '../types';
import { JupyterNotebookView } from './constants';
import { trackKernelInfoInNotebookMetadata } from './helpers/helpers';

// IANHU: Rename file, rename class?
export class VSCodeNotebookController implements Disposable {
    private notebookKernels = new WeakMap<NotebookDocument, IKernel>();
    private controller: NotebookController;
    private isDisposed = false;

    get id() {
        return this.controller.id;
    }

    // IANHU: Passing the API in here? Not sure if that is right, but I like this class owning the create
    constructor(private readonly document: NotebookDocument, private readonly kernelConnection: KernelConnectionMetadata,
        private readonly notebookApi: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        private readonly kernelProvider: IKernelProvider,
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider) {
        const selector: NotebookSelector = { viewType: JupyterNotebookView, pattern: document.uri.fsPath };
        const id: string = `${document.uri.toString()} - ${kernelConnection.id}`;
        // IANHU: Preloads go here as well
        this.controller = this.notebookApi.createNotebookController(id, selector, getDisplayNameOrNameOfKernelConnection(kernelConnection), this.handleExecution.bind(this));
        // IANHU: Detail is missing
        this.controller.description = getDescriptionOfKernelConnection(kernelConnection);
        this.controller.hasExecutionOrder = true;
        this.controller.supportedLanguages = ['python'];
    }

    public dispose() {
        // IANHU: Need to make sure to check our disposes here
        if (!this.isDisposed) {
            this.isDisposed = true;
            this.controller.dispose();
        }
    }

    // IANHU: Is the async an issue here? 
    private async handleExecution(cells: NotebookCell[]) {
        // When we receive a cell execute request, first ensure that the notebook is trusted.
        // If it isn't already trusted, block execution until the user trusts it.
        const isTrusted = await this.commandManager.executeCommand(Commands.TrustNotebook, this.document.uri);
        if (!isTrusted) {
            return;
        }
        // Notebook is trusted. Continue to execute cells
        //const cells = document
        //.getCells()
        //.filter(
        //(cell) =>
        //cell.kind === NotebookCellKind.Code &&
        //ranges.some((range) => range.start <= cell.index && cell.index < range.end)
        //);
        traceInfo(`Execute Cells request ${cells.length} ${cells.map((cell) => cell.index).join(', ')}`);
        await Promise.all(cells.map((cell) => this.executeCell(this.document, cell)));
    }

    private executeCell(doc: NotebookDocument, cell: NotebookCell) {
        traceInfo(`Execute Cell ${cell.index} ${cell.notebook.uri.toString()} in kernelWithMetadata.ts`);
        const kernel = this.kernelProvider.getOrCreate(cell.notebook.uri, { metadata: this.kernelConnection });
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
        this.notebookApi.onDidCloseNotebookDocument(
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
            const editor = this.notebookApi.notebookEditors.find((item) => item.document === doc);
            if (!editor || editor.kernel?.id !== this.id) {
                return;
            }
            trackKernelInfoInNotebookMetadata(doc, kernel.info);
            if (this.kernelConnection.kind === 'startUsingKernelSpec') {
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