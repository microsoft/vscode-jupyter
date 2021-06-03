// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { join } from 'path';
import {
    Disposable,
    env,
    EventEmitter,
    ExtensionMode,
    languages,
    NotebookCell,
    NotebookController,
    NotebookControllerAffinity,
    NotebookDocument,
    NotebookEditor,
    NotebookRendererScript,
    UIKind,
    Uri
} from 'vscode';
import { ICommandManager, IVSCodeNotebook, IWorkspaceService } from '../../common/application/types';
import { JVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../../common/constants';
import { disposeAllDisposables } from '../../common/helpers';
import { traceInfo } from '../../common/logger';
import { IDisposable, IDisposableRegistry, IExtensionContext, IPathUtils } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { ConsoleForegroundColors } from '../../logging/_global';
import { Commands } from '../constants';
import {
    getDescriptionOfKernelConnection,
    getDetailOfKernelConnection,
    isPythonKernelConnection
} from '../jupyter/kernels/helpers';
import { IKernel, IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { PreferredRemoteKernelIdProvider } from '../notebookStorage/preferredRemoteKernelIdProvider';
import { KernelSocketInformation } from '../types';
import { NotebookCellLanguageService } from './cellLanguageService';
import { JupyterNotebookView } from './constants';
import {
    isSameAsTrackedKernelInNotebookMetadata,
    traceCellMessage,
    trackKernelInfoInNotebookMetadata,
    trackKernelInNotebookMetadata
} from './helpers/helpers';
import { INotebookControllerManager } from './types';

export class VSCodeNotebookController implements Disposable {
    private readonly _onNotebookControllerSelected: EventEmitter<{
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }>;
    private readonly disposables: IDisposable[] = [];
    private notebookKernels = new WeakMap<NotebookDocument, IKernel>();
    public readonly controller: NotebookController;
    /**
     * Used purely for testing purposes.
     */
    public static kernelAssociatedWithDocument?: boolean;
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
    get onDidReceiveMessage() {
        return this.controller.onDidReceiveMessage;
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
        disposableRegistry: IDisposableRegistry,
        private readonly languageService: NotebookCellLanguageService,
        private readonly workspace: IWorkspaceService
    ) {
        disposableRegistry.push(this);
        this._onNotebookControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: VSCodeNotebookController;
        }>();

        this.controller = this.notebookApi.createNotebookController(
            kernelConnection.id,
            JupyterNotebookView,
            label,
            this.handleExecution.bind(this),
            this.getRendererScripts()
        );

        // Fill in extended info for our controller
        this.controller.interruptHandler = this.handleInterrupt.bind(this);
        this.controller.description = getDescriptionOfKernelConnection(kernelConnection);
        this.controller.detail = getDetailOfKernelConnection(kernelConnection, this.pathUtils);
        this.controller.supportsExecutionOrder = true;
        this.controller.supportedLanguages = this.languageService.getSupportedLanguages(kernelConnection);
        // Hook up to see when this NotebookController is selected by the UI
        this.controller.onDidChangeSelectedNotebooks(this.onDidChangeSelectedNotebooks, this, this.disposables);
    }

    public asWebviewUri(localResource: Uri): Uri {
        return this.controller.asWebviewUri(localResource);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public postMessage(message: any, editor?: NotebookEditor): Thenable<boolean> {
        const messageType = message && 'message' in message ? message.message : '';
        traceInfo(`${ConsoleForegroundColors.Green}Posting message to Notebook UI ${messageType}`);
        return this.controller.postMessage(message, editor);
    }

    public dispose() {
        if (!this.isDisposed) {
            this.isDisposed = true;
            this._onNotebookControllerSelected.dispose();
            this.controller.dispose();
        }
        disposeAllDisposables(this.disposables);
    }

    public async updateNotebookAffinity(notebook: NotebookDocument, affinity: NotebookControllerAffinity) {
        traceInfo(`Setting controller affinity for ${notebook.uri.toString()} ${this.id}`);
        this.controller.updateNotebookAffinity(notebook, affinity);
        // Only on CI Server.
        if (this.context.extensionMode === ExtensionMode.Test) {
            traceInfo(`Force selection of controller for ${notebook.uri.toString()} ${this.id}`);
            await this.commandManager.executeCommand('notebook.selectKernel', {
                id: this.id,
                extension: JVSC_EXTENSION_ID
            });
            traceInfo(
                `VSCodeNotebookController.kernelAssociatedWithDocument set for ${notebook.uri.toString()} ${this.id}`
            );
            VSCodeNotebookController.kernelAssociatedWithDocument = true;
        }
    }

    // Handle the execution of notebook cell
    private async handleExecution(cells: NotebookCell[]) {
        if (cells.length < 1) {
            traceInfo('No cells passed to handleExecution');
            return;
        }
        // Get our target document
        const targetNotebook = cells[0].notebook;

        // When we receive a cell execute request, first ensure that the notebook is trusted.
        // If it isn't already trusted, block execution until the user trusts it.
        if (!this.workspace.isTrusted) {
            return;
        }
        // Notebook is trusted. Continue to execute cells
        traceInfo(`Execute Cells request ${cells.length} ${cells.map((cell) => cell.index).join(', ')}`);
        await Promise.all(cells.map((cell) => this.executeCell(targetNotebook, cell)));
    }
    private async onDidChangeSelectedNotebooks(event: { notebook: NotebookDocument; selected: boolean }) {
        // If this NotebookController was selected, fire off the event
        if (event.selected) {
            await this.updateCellLanguages(event.notebook);
            this._onNotebookControllerSelected.fire({ notebook: event.notebook, controller: this });
        } else {
            // If this controller was what was previously selected, then wipe that information out.
            // This happens when user selects our controller & then selects another controller e.g. (.NET Extension).
            // If the user selects one of our controllers (kernels), then this gets initialized elsewhere.
            if (isSameAsTrackedKernelInNotebookMetadata(event.notebook, this.connection)) {
                trackKernelInNotebookMetadata(event.notebook, undefined);
            }
        }
    }
    /**
     * Scenario 1:
     * Assume user opens a notebook and language is C++ or .NET Interactive, they start writing python code.
     * Next users hits the run button, next user will be promtped to select a kernel.
     * User now selects a Python kernel.
     * Nothing happens, that's right nothing happens.
     * This is because C++ is not a lanaugage supported by the python kernel.
     * Hence VS Code will not send the execution call to the extension.
     *
     * Solution, go through the cells and change the languges to something that's supported.
     *
     * Scenario 2:
     * User has .NET extension installed.
     * User opens a Python notebook and runs a cell with a .NET kernel (accidentally or deliberately).
     * User gets errors in output & realizes mistake & changes the kernel.
     * Now user runs a cell & nothing happens again.
     */
    private async updateCellLanguages(notebook: NotebookDocument) {
        const supportedLanguages = this.controller.supportedLanguages;
        // If the controller doesn't have any preferred languages, then get out.
        if (!supportedLanguages || supportedLanguages?.length === 0) {
            return;
        }
        const isPythonKernel = isPythonKernelConnection(this.kernelConnection);
        const preferredLanguage = isPythonKernel ? PYTHON_LANGUAGE : supportedLanguages[0];
        await Promise.all(
            notebook.getCells().map(async (cell) => {
                if (!supportedLanguages.includes(cell.document.languageId)) {
                    await languages.setTextDocumentLanguage(cell.document, preferredLanguage).then(noop, noop);
                }
            })
        );
    }
    private getRendererScripts(): NotebookRendererScript[] {
        // Work around for known issue with CodeSpaces
        const codeSpaceScripts =
            env.uiKind === UIKind.Web
                ? [join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'require.js')]
                : [];
        return [
            ...codeSpaceScripts,
            join(this.context.extensionPath, 'out', 'ipywidgets', 'dist', 'ipywidgets.js'),

            join(this.context.extensionPath, 'out', 'datascience-ui', 'ipywidgetsKernel', 'ipywidgetsKernel.js'),
            join(this.context.extensionPath, 'out', 'datascience-ui', 'notebook', 'fontAwesomeLoader.js')
        ].map((uri) => new NotebookRendererScript(Uri.file(uri)));
    }

    private handleInterrupt(notebook: NotebookDocument) {
        notebook.getCells().forEach((cell) => traceCellMessage(cell, 'Cell cancellation requested'));
        this.commandManager
            .executeCommand(Commands.NotebookEditorInterruptKernel, notebook.uri)
            .then(noop, (ex) => console.error(ex));
    }

    private executeCell(doc: NotebookDocument, cell: NotebookCell) {
        traceInfo(`Execute Cell ${cell.index} ${cell.notebook.uri.toString()}`);
        const kernel = this.kernelProvider.getOrCreate(cell.notebook.uri, {
            metadata: this.kernelConnection,
            controller: this.controller
        });
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
