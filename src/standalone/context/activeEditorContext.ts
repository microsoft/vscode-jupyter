// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { NotebookEditor, TextEditor } from 'vscode';
import { IKernel, IKernelProvider, isRemoteConnection } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { ICommandManager, IDocumentManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { EditorContexts, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { ContextKey } from '../../platform/common/contextKey';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { isNotebookCell, noop } from '../../platform/common/utils/misc';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';
import { IInteractiveWindowProvider, IInteractiveWindow } from '../../interactive-window/types';
import { getNotebookMetadata, isJupyterNotebook } from '../../platform/common/utils';
import { isPythonNotebook } from '../../kernels/helpers';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { IJupyterServerProviderRegistry } from '../../kernels/jupyter/types';

/**
 * Tracks a lot of the context keys needed in the extension.
 */
@injectable()
export class ActiveEditorContextService implements IExtensionSyncActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    private nativeContext: ContextKey;
    private interactiveContext: ContextKey;
    private interactiveOrNativeContext: ContextKey;
    private pythonOrInteractiveContext: ContextKey;
    private pythonOrNativeContext: ContextKey;
    private pythonOrInteractiveOrNativeContext: ContextKey;
    private canRestartNotebookKernelContext: ContextKey;
    private canInterruptNotebookKernelContext: ContextKey;
    private canRestartInteractiveWindowKernelContext: ContextKey;
    private canInterruptInteractiveWindowKernelContext: ContextKey;
    private hasNativeNotebookCells: ContextKey;
    private isPythonFileActive: boolean = false;
    private isPythonNotebook: ContextKey;
    private isJupyterKernelSelected: ContextKey;
    private hasNativeNotebookOrInteractiveWindowOpen: ContextKey;
    private kernelSourceContext: ContextKey<string>;
    constructor(
        @inject(IInteractiveWindowProvider)
        @optional()
        private readonly interactiveProvider: IInteractiveWindowProvider | undefined,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IControllerRegistration) private readonly controllers: IControllerRegistration,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterUriProviderRegistration: IJupyterServerProviderRegistry
    ) {
        disposables.push(this);
        this.nativeContext = new ContextKey(EditorContexts.IsNativeActive, this.commandManager);
        this.canRestartNotebookKernelContext = new ContextKey(
            EditorContexts.CanRestartNotebookKernel,
            this.commandManager
        );
        this.canInterruptNotebookKernelContext = new ContextKey(
            EditorContexts.CanInterruptNotebookKernel,
            this.commandManager
        );
        this.canRestartInteractiveWindowKernelContext = new ContextKey(
            EditorContexts.CanRestartInteractiveWindowKernel,
            this.commandManager
        );
        this.canInterruptInteractiveWindowKernelContext = new ContextKey(
            EditorContexts.CanInterruptInteractiveWindowKernel,
            this.commandManager
        );
        this.interactiveContext = new ContextKey(EditorContexts.IsInteractiveActive, this.commandManager);
        this.interactiveOrNativeContext = new ContextKey(
            EditorContexts.IsInteractiveOrNativeActive,
            this.commandManager
        );
        this.pythonOrNativeContext = new ContextKey(EditorContexts.IsPythonOrNativeActive, this.commandManager);
        this.pythonOrInteractiveContext = new ContextKey(
            EditorContexts.IsPythonOrInteractiveActive,
            this.commandManager
        );
        this.pythonOrInteractiveOrNativeContext = new ContextKey(
            EditorContexts.IsPythonOrInteractiveOrNativeActive,
            this.commandManager
        );
        this.hasNativeNotebookCells = new ContextKey(EditorContexts.HaveNativeCells, this.commandManager);
        this.isPythonNotebook = new ContextKey(EditorContexts.IsPythonNotebook, this.commandManager);
        this.isJupyterKernelSelected = new ContextKey(EditorContexts.IsJupyterKernelSelected, this.commandManager);
        this.hasNativeNotebookOrInteractiveWindowOpen = new ContextKey(
            EditorContexts.HasNativeNotebookOrInteractiveWindowOpen,
            this.commandManager
        );
        this.kernelSourceContext = new ContextKey(EditorContexts.KernelSource, this.commandManager);
    }
    public dispose() {
        this.disposables.forEach((item) => item.dispose());
    }
    public activate() {
        this.docManager.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, this.disposables);
        this.kernelProvider.onKernelStatusChanged(this.onDidKernelStatusChange, this, this.disposables);
        // Interactive provider might not be available
        if (this.interactiveProvider) {
            this.interactiveProvider.onDidChangeActiveInteractiveWindow(
                this.onDidChangeActiveInteractiveWindow,
                this,
                this.disposables
            );

            if (this.interactiveProvider.activeWindow) {
                this.onDidChangeActiveInteractiveWindow();
            }
        }
        if (this.vscNotebook.activeNotebookEditor) {
            this.onDidChangeActiveNotebookEditor(this.vscNotebook.activeNotebookEditor);
        }
        this.vscNotebook.onDidChangeActiveNotebookEditor(this.onDidChangeActiveNotebookEditor, this, this.disposables);

        // Do we already have python file opened.
        if (this.docManager.activeTextEditor?.document.languageId === PYTHON_LANGUAGE) {
            this.onDidChangeActiveTextEditor(this.docManager.activeTextEditor);
        }
        this.vscNotebook.onDidChangeNotebookEditorSelection(
            this.updateNativeNotebookInteractiveWindowOpenContext,
            this,
            this.disposables
        );
        this.vscNotebook.onDidOpenNotebookDocument(
            this.updateNativeNotebookInteractiveWindowOpenContext,
            this,
            this.disposables
        );
        this.vscNotebook.onDidCloseNotebookDocument(
            this.updateNativeNotebookInteractiveWindowOpenContext,
            this,
            this.disposables
        );
        this.controllers.onControllerSelectionChanged(() => this.updateSelectedKernelContext(), this, this.disposables);
        this.updateSelectedKernelContext();
    }

    private updateNativeNotebookCellContext() {
        // Separate for debugging.
        const hasNativeCells = (this.vscNotebook.activeNotebookEditor?.notebook.cellCount || 0) > 0;
        this.hasNativeNotebookCells.set(hasNativeCells).catch(noop);
    }
    private onDidChangeActiveInteractiveWindow(e?: IInteractiveWindow) {
        this.interactiveContext.set(!!e).catch(noop);
        this.updateNativeNotebookInteractiveWindowOpenContext();
        this.updateMergedContexts();
        this.updateContextOfActiveInteractiveWindowKernel();
    }
    private onDidChangeActiveNotebookEditor(e?: NotebookEditor) {
        const isJupyterNotebookDoc = e ? e.notebook.notebookType === JupyterNotebookView : false;
        this.nativeContext.set(isJupyterNotebookDoc).catch(noop);

        this.isPythonNotebook
            .set(e && isJupyterNotebookDoc ? isPythonNotebook(getNotebookMetadata(e.notebook)) : false)
            .catch(noop);
        this.updateContextOfActiveNotebookKernel(e);
        this.updateContextOfActiveInteractiveWindowKernel();
        this.updateNativeNotebookInteractiveWindowOpenContext();
        this.updateNativeNotebookCellContext();
        this.updateMergedContexts();
    }
    private updateNativeNotebookInteractiveWindowOpenContext() {
        this.hasNativeNotebookOrInteractiveWindowOpen
            .set(
                this.vscNotebook.notebookDocuments.some(
                    (nb) => nb.notebookType === JupyterNotebookView || nb.notebookType === InteractiveWindowView
                )
            )
            .catch(noop);
    }
    private updateContextOfActiveNotebookKernel(activeEditor?: NotebookEditor) {
        const kernel =
            activeEditor && activeEditor.notebook.notebookType === JupyterNotebookView
                ? this.kernelProvider.get(activeEditor.notebook)
                : undefined;
        if (kernel) {
            const canStart = kernel.status !== 'unknown';
            this.canRestartNotebookKernelContext.set(!!canStart).catch(noop);
            const canInterrupt = kernel.status === 'busy';
            this.canInterruptNotebookKernelContext.set(!!canInterrupt).catch(noop);
        } else {
            this.canRestartNotebookKernelContext.set(false).catch(noop);
            this.canInterruptNotebookKernelContext.set(false).catch(noop);
        }
        this.updateKernelSourceContext(kernel).catch(noop);
        this.updateSelectedKernelContext();
    }
    private async updateKernelSourceContext(kernel: IKernel | undefined) {
        if (!kernel || !isRemoteConnection(kernel.kernelConnectionMetadata)) {
            this.kernelSourceContext.set('').catch(noop);
            return;
        }

        const connection = kernel.kernelConnectionMetadata;
        const provider = await this.jupyterUriProviderRegistration.jupyterCollections.find(
            (c) =>
                c.extensionId === connection.serverProviderHandle.extensionId &&
                c.id === connection.serverProviderHandle.id
        );

        if (!provider) {
            this.kernelSourceContext.set('').catch(noop);
            return;
        }

        this.kernelSourceContext.set(provider.id).catch(noop);
    }
    private updateSelectedKernelContext() {
        const document =
            this.vscNotebook.activeNotebookEditor?.notebook ||
            this.interactiveProvider?.getActiveOrAssociatedInteractiveWindow()?.notebookDocument;
        if (document && isJupyterNotebook(document) && this.controllers.getSelected(document)) {
            this.isJupyterKernelSelected.set(true).catch(noop);
        } else {
            this.isJupyterKernelSelected.set(false).catch(noop);
        }
    }
    private updateContextOfActiveInteractiveWindowKernel() {
        const notebook = this.interactiveProvider?.getActiveOrAssociatedInteractiveWindow()?.notebookDocument;
        const kernel = notebook ? this.kernelProvider.get(notebook) : undefined;
        if (kernel) {
            const canStart = kernel.status !== 'unknown';
            this.canRestartInteractiveWindowKernelContext.set(!!canStart).catch(noop);
            const canInterrupt = kernel.status === 'busy';
            this.canInterruptInteractiveWindowKernelContext.set(!!canInterrupt).catch(noop);
        } else {
            this.canRestartInteractiveWindowKernelContext.set(false).catch(noop);
            this.canInterruptInteractiveWindowKernelContext.set(false).catch(noop);
        }
        this.updateSelectedKernelContext();
    }
    private onDidKernelStatusChange({ kernel }: { kernel: IKernel }) {
        const notebook = kernel.notebook;
        if (notebook.notebookType === InteractiveWindowView) {
            this.updateContextOfActiveInteractiveWindowKernel();
        } else if (
            notebook.notebookType === JupyterNotebookView &&
            notebook === this.vscNotebook.activeNotebookEditor?.notebook
        ) {
            this.updateContextOfActiveNotebookKernel(this.vscNotebook.activeNotebookEditor);
        }
    }
    private onDidChangeActiveTextEditor(e?: TextEditor) {
        this.isPythonFileActive = e?.document.languageId === PYTHON_LANGUAGE && !isNotebookCell(e.document.uri);
        this.updateNativeNotebookCellContext();
        this.updateMergedContexts();
        this.updateContextOfActiveInteractiveWindowKernel();
    }
    private updateMergedContexts() {
        this.interactiveOrNativeContext
            .set(this.nativeContext.value === true || this.interactiveContext.value === true)
            .catch(noop);
        this.pythonOrNativeContext
            .set(this.nativeContext.value === true || this.isPythonFileActive === true)
            .catch(noop);
        this.pythonOrInteractiveContext
            .set(this.interactiveContext.value === true || this.isPythonFileActive === true)
            .catch(noop);
        this.pythonOrInteractiveOrNativeContext
            .set(
                this.nativeContext.value === true ||
                    (this.interactiveContext.value === true && this.isPythonFileActive === true)
            )
            .catch(noop);
    }
}
