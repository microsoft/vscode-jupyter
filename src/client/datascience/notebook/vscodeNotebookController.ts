// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { join } from 'path';
import {
    Disposable,
    EventEmitter,
    NotebookCell,
    NotebookController,
    NotebookDocument,
    NotebookKernelPreload,
    Uri
} from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { disposeAllDisposables } from '../../common/helpers';
import { traceInfo } from '../../common/logger';
import { IDisposable, IDisposableRegistry, IExtensionContext, IPathUtils } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { translateKernelLanguageToMonaco } from '../common';
import { Commands, KnownNotebookLanguages } from '../constants';
import { getDescriptionOfKernelConnection, getDetailOfKernelConnection } from '../jupyter/kernels/helpers';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { KernelSocketInformation } from '../types';
import { JupyterNotebookView } from './constants';
import { traceCellMessage, trackKernelInfoInNotebookMetadata } from './helpers/helpers';
import { INotebookControllerManager } from './types';

export class VSCodeNotebookController implements Disposable {
    private readonly _onNotebookControllerSelected: EventEmitter<{
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }>;
    private notebookKernels = new WeakMap<NotebookDocument, IKernel>();
    private controller: NotebookController;
    private isDisposed = false;

    get id() {
        return this.controller.id;
    }

    get label() {
        return this.controller.label;
    }

    get connection() {
        return this.kernelConnection;
    }

    get onNotebookControllerSelected() {
        return this._onNotebookControllerSelected.event;
    }

    constructor(
        private readonly kernelConnection: KernelConnectionMetadata,
        label: string,
        private readonly notebookApi: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        private readonly kernelProvider: IKernelProvider,
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider,
        private readonly context: IExtensionContext,
        private readonly notebookControllerManager: INotebookControllerManager,
        private readonly pathUtils: IPathUtils,
        private readonly disposable: IDisposableRegistry
    ) {
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();

        this.controller = this.notebookApi.createNotebookController(
            kernelConnection.id,
            JupyterNotebookView,
            label,
            this.handleExecution.bind(this),
            this.getPreloads()
        );

        // Fill in extended info for our controller
        this.controller.interruptHandler = this.handleInterrupt.bind(this);
        this.controller.description = getDescriptionOfKernelConnection(kernelConnection);
        this.controller.detail = getDetailOfKernelConnection(kernelConnection, this.pathUtils);
        this.controller.hasExecutionOrder = true;

        // KERNELPUSH: We used to be able to leave this empty to support all languages
        // However this is now required to execute a cell, if not specified the cell will not run if the the language does
        // not match. Using our known list for now
        // IANHU: Was this updated? Check if we can just specify nothing
        // this.controller.supportedLanguages = KnownNotebookLanguages.map((lang) => {
        // return translateKernelLanguageToMonaco(lang);
        // });

        // Hook up to see when this NotebookController is selected by the UI
        this.controller.onDidChangeNotebookAssociation(this.onDidChangeNotebookAssociation, this, this.disposable);
    }

    public dispose() {
        if (!this.isDisposed) {
            this.isDisposed = true;
            this._onNotebookControllerSelected.dispose();
            this.controller.dispose();
        }
    }

    // Handle the execution of notebook cell
    public async handleExecution(cells: NotebookCell[]) {
        if (cells.length < 1) {
            traceInfo('No cells passed to handleExecution');
            return;
        }
        // Get our target document
        const targetNotebook = cells[0].notebook;

        // When we receive a cell execute request, first ensure that the notebook is trusted.
        // If it isn't already trusted, block execution until the user trusts it.
        const isTrusted = await this.commandManager.executeCommand(Commands.TrustNotebook, targetNotebook.uri);
        if (!isTrusted) {
            return;
        }
        // Notebook is trusted. Continue to execute cells
        traceInfo(`Execute Cells request ${cells.length} ${cells.map((cell) => cell.index).join(', ')}`);
        await Promise.all(cells.map((cell) => this.executeCell(targetNotebook, cell)));
    }

    private onDidChangeNotebookAssociation(event: { notebook: NotebookDocument; selected: boolean }) {
        // If this NotebookController was selected, fire off the event
        if (event.selected) {
            this._onNotebookControllerSelected.fire({ notebook: event.notebook, controller: this });
        }
    }

    private getPreloads(): NotebookKernelPreload[] {
        return [
            { uri: Uri.file(join(this.context.extensionPath, 'out', 'ipywidgets', 'dist', 'ipywidgets.js')) },
            {
                uri: Uri.file(
                    join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'ipywidgetsKernel.js')
                )
            },
            {
                uri: Uri.file(
                    join(this.context.extensionPath, 'out', 'datascience-ui', 'notebook', 'fontAwesomeLoader.js')
                )
            }
        ];
    }

    // IANHU: Deal with notebook document here
    private handleInterrupt(notebook: NotebookDocument) {
        notebook.getCells().forEach((cell) => traceCellMessage(cell, 'Cell cancellation requested'));
        this.commandManager
            .executeCommand(Commands.NotebookEditorInterruptKernel, notebook)
            .then(noop, (ex) => console.error(ex));
    }

    // IANHU: Get document URI from cells
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

            const documentConnection = this.notebookControllerManager.getSelectedNotebookController(doc);
            if (!documentConnection || documentConnection.id !== this.id) {
                // Disregard if we've changed kernels
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
