// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookEditor, TextEditor } from 'vscode';
import { ServerStatus } from '../../../datascience-ui/interactive-common/mainState';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ICommandManager, IDocumentManager, IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { ContextKey } from '../../common/contextKey';
import { traceError } from '../../common/logger';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { isNotebookCell } from '../../common/utils/misc';
import { EditorContexts } from '../constants';
import { getNotebookMetadata, isJupyterNotebook, isPythonNotebook } from '../notebook/helpers/helpers';
import { IInteractiveWindow, IInteractiveWindowProvider, INotebook, INotebookProvider } from '../types';

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
    private hasNativeNotebookCells: ContextKey;
    private isPythonFileActive: boolean = false;
    private isPythonNotebook: ContextKey;
    private hasNativeNotebookOpen: ContextKey;
    constructor(
        @inject(IInteractiveWindowProvider) private readonly interactiveProvider: IInteractiveWindowProvider,
        @inject(IDocumentManager) private readonly docManager: IDocumentManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook
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
        this.hasNativeNotebookOpen = new ContextKey(EditorContexts.HasNativeNotebookOpen, this.commandManager);
    }
    public dispose() {
        this.disposables.forEach((item) => item.dispose());
    }
    public async activate(): Promise<void> {
        this.docManager.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, this.disposables);
        this.notebookProvider.onSessionStatusChanged(this.onDidKernelStatusChange, this, this.disposables);
        this.interactiveProvider.onDidChangeActiveInteractiveWindow(
            this.onDidChangeActiveInteractiveWindow,
            this,
            this.disposables
        );
        this.vscNotebook.onDidChangeActiveNotebookEditor(this.onDidChangeActiveNotebookEditor, this, this.disposables);

        // Do we already have python file opened.
        if (this.docManager.activeTextEditor?.document.languageId === PYTHON_LANGUAGE) {
            this.onDidChangeActiveTextEditor(this.docManager.activeTextEditor);
        }
        this.vscNotebook.onDidChangeNotebookEditorSelection(this.updateNativeNotebookContext, this, this.disposables);
        this.vscNotebook.onDidCloseNotebookDocument(this.updateNativeNotebookContext, this, this.disposables);
    }

    private updateNativeNotebookCellContext() {
        // Separate for debugging.
        const hasNativeCells = (this.vscNotebook.activeNotebookEditor?.document.cellCount || 0) > 0;
        this.hasNativeNotebookCells.set(hasNativeCells).ignoreErrors();
    }
    private onDidChangeActiveInteractiveWindow(e?: IInteractiveWindow) {
        this.interactiveContext.set(!!e).ignoreErrors();
        this.updateMergedContexts();
    }
    private onDidChangeActiveNotebookEditor(e?: NotebookEditor) {
        const isJupyterNotebookDoc = e ? isJupyterNotebook(e.document) : false;
        this.nativeContext.set(isJupyterNotebookDoc).ignoreErrors();

        this.isPythonNotebook
            .set(e && isJupyterNotebookDoc ? isPythonNotebook(getNotebookMetadata(e.document)) : false)
            .ignoreErrors();
        this.updateContextOfActiveNotebookKernel(e);
        this.updateNativeNotebookContext();
        this.updateNativeNotebookCellContext();
        this.updateMergedContexts();
    }
    private updateNativeNotebookContext() {
        this.hasNativeNotebookOpen.set(this.vscNotebook.notebookDocuments.some(isJupyterNotebook)).ignoreErrors();
    }
    private updateContextOfActiveNotebookKernel(activeEditor?: NotebookEditor) {
        if (activeEditor && isJupyterNotebook(activeEditor.document)) {
            this.notebookProvider
                .getOrCreateNotebook({
                    identity: activeEditor.document.uri,
                    resource: activeEditor.document.uri,
                    getOnly: true
                })
                .then(async (nb) => {
                    if (activeEditor === this.vscNotebook.activeNotebookEditor) {
                        const canStart = nb && nb.status !== ServerStatus.NotStarted;
                        this.canRestartNotebookKernelContext.set(!!canStart).ignoreErrors();
                        const canInterrupt = nb && nb.status === ServerStatus.Busy;
                        this.canInterruptNotebookKernelContext.set(!!canInterrupt).ignoreErrors();
                    }
                })
                .catch(
                    traceError.bind(undefined, 'Failed to determine if a notebook is active for the current editor')
                );
        } else {
            this.canRestartNotebookKernelContext.set(false).ignoreErrors();
            this.canInterruptNotebookKernelContext.set(false).ignoreErrors();
        }
    }
    private onDidKernelStatusChange({ notebook }: { status: ServerStatus; notebook: INotebook }) {
        // Ok, kernel status has changed.
        const activeEditor = this.vscNotebook.activeNotebookEditor;
        if (!activeEditor) {
            return;
        }
        if (activeEditor.document.uri.toString() !== notebook.identity.toString()) {
            // Status of a notebook thats not related to active editor has changed.
            // We can ignore that.
            return;
        }
        this.updateContextOfActiveNotebookKernel(activeEditor);
    }
    private onDidChangeActiveTextEditor(e?: TextEditor) {
        this.isPythonFileActive = e?.document.languageId === PYTHON_LANGUAGE && !isNotebookCell(e.document.uri);
        this.updateNativeNotebookCellContext();
        this.updateMergedContexts();
    }
    private updateMergedContexts() {
        this.interactiveOrNativeContext
            .set(this.nativeContext.value === true && this.interactiveContext.value === true)
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
