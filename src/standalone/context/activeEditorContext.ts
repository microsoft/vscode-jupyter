// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable, optional } from 'inversify';
import { NotebookEditor, TextEditor } from 'vscode';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { ICommandManager, IDocumentManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { EditorContexts, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { ContextKey } from '../../platform/common/contextKey';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { isNotebookCell, noop } from '../../platform/common/utils/misc';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';
import { IInteractiveWindowProvider, IInteractiveWindow } from '../../interactive-window/types';
import { getNotebookMetadata, isJupyterNotebook } from '../../platform/common/utils';
import { isPythonNotebook } from '../../kernels/helpers';
import { IControllerSelection } from '../../notebooks/controllers/types';

/**
 * Tracks a lot of the context keys needed in the extension.
 */
@injectable()
export class ActiveEditorContextService implements IExtensionSingleActivationService, IDisposable {
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
    constructor(
        @inject(IInteractiveWindowProvider)
        @optional()
        private readonly interactiveProvider: IInteractiveWindowProvider | undefined,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IControllerSelection) private readonly controllers: IControllerSelection
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
    }
    public dispose() {
        this.disposables.forEach((item) => item.dispose());
    }
    public async activate(): Promise<void> {
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
        this.hasNativeNotebookCells.set(hasNativeCells).ignoreErrors();
    }
    private onDidChangeActiveInteractiveWindow(e?: IInteractiveWindow) {
        this.interactiveContext.set(!!e).ignoreErrors();
        this.updateNativeNotebookInteractiveWindowOpenContext();
        this.updateMergedContexts();
        this.updateContextOfActiveInteractiveWindowKernel();
    }
    private onDidChangeActiveNotebookEditor(e?: NotebookEditor) {
        const isJupyterNotebookDoc = e ? e.notebook.notebookType === JupyterNotebookView : false;
        this.nativeContext.set(isJupyterNotebookDoc).ignoreErrors();

        this.isPythonNotebook
            .set(e && isJupyterNotebookDoc ? isPythonNotebook(getNotebookMetadata(e.notebook)) : false)
            .ignoreErrors();
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
            .ignoreErrors();
    }
    private updateContextOfActiveNotebookKernel(activeEditor?: NotebookEditor) {
        const kernel =
            activeEditor && activeEditor.notebook.notebookType === JupyterNotebookView
                ? this.kernelProvider.get(activeEditor.notebook)
                : undefined;
        if (kernel) {
            const canStart = kernel.status !== 'unknown';
            this.canRestartNotebookKernelContext.set(!!canStart).ignoreErrors();
            const canInterrupt = kernel.status === 'busy';
            this.canInterruptNotebookKernelContext.set(!!canInterrupt).ignoreErrors();
        } else {
            this.canRestartNotebookKernelContext.set(false).ignoreErrors();
            this.canInterruptNotebookKernelContext.set(false).ignoreErrors();
        }
        this.updateSelectedKernelContext();
    }
    private updateSelectedKernelContext() {
        const document =
            this.vscNotebook.activeNotebookEditor?.notebook ||
            this.interactiveProvider?.getActiveOrAssociatedInteractiveWindow()?.notebookEditor?.notebook;
        if (document && isJupyterNotebook(document) && this.controllers.getSelected(document)) {
            this.isJupyterKernelSelected.set(true).catch(noop);
        } else {
            this.isJupyterKernelSelected.set(false).catch(noop);
        }
    }
    private updateContextOfActiveInteractiveWindowKernel() {
        const notebook = this.interactiveProvider?.getActiveOrAssociatedInteractiveWindow()?.notebookEditor?.notebook;
        const kernel = notebook ? this.kernelProvider.get(notebook) : undefined;
        if (kernel) {
            const canStart = kernel.status !== 'unknown';
            this.canRestartInteractiveWindowKernelContext.set(!!canStart).ignoreErrors();
            const canInterrupt = kernel.status === 'busy';
            this.canInterruptInteractiveWindowKernelContext.set(!!canInterrupt).ignoreErrors();
        } else {
            this.canRestartInteractiveWindowKernelContext.set(false).ignoreErrors();
            this.canInterruptInteractiveWindowKernelContext.set(false).ignoreErrors();
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
            .ignoreErrors();
        this.pythonOrNativeContext
            .set(this.nativeContext.value === true || this.isPythonFileActive === true)
            .ignoreErrors();
        this.pythonOrInteractiveContext
            .set(this.interactiveContext.value === true || this.isPythonFileActive === true)
            .ignoreErrors();
        this.pythonOrInteractiveOrNativeContext
            .set(
                this.nativeContext.value === true ||
                    (this.interactiveContext.value === true && this.isPythonFileActive === true)
            )
            .ignoreErrors();
    }
}
