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
import { getActiveInteractiveWindow } from '../interactive-window/helpers';
import { InteractiveWindowView, JupyterNotebookView } from '../notebook/constants';
import { getNotebookMetadata, isPythonNotebook } from '../notebook/helpers/helpers';
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
    private canRestartInteractiveWindowKernelContext: ContextKey;
    private canInterruptInteractiveWindowKernelContext: ContextKey;
    private hasNativeNotebookCells: ContextKey;
    private isPythonFileActive: boolean = false;
    private isPythonNotebook: ContextKey;
    private hasNativeNotebookOrInteractiveWindowOpen: ContextKey;
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
        this.notebookProvider.onSessionStatusChanged(this.onDidKernelStatusChange, this, this.disposables);
        this.interactiveProvider.onDidChangeActiveInteractiveWindow(
            this.onDidChangeActiveInteractiveWindow,
            this,
            this.disposables
        );
        if (this.vscNotebook.activeNotebookEditor) {
            this.onDidChangeActiveNotebookEditor(this.vscNotebook.activeNotebookEditor);
        }
        if (this.interactiveProvider.activeWindow) {
            this.onDidChangeActiveInteractiveWindow();
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
    }

    private updateNativeNotebookCellContext() {
        // Separate for debugging.
        const hasNativeCells = (this.vscNotebook.activeNotebookEditor?.document.cellCount || 0) > 0;
        this.hasNativeNotebookCells.set(hasNativeCells).ignoreErrors();
    }
    private onDidChangeActiveInteractiveWindow(e?: IInteractiveWindow) {
        this.interactiveContext.set(!!e).ignoreErrors();
        this.updateNativeNotebookInteractiveWindowOpenContext();
        this.updateMergedContexts();
        this.updateContextOfActiveInteractiveWindowKernel();
    }
    private onDidChangeActiveNotebookEditor(e?: NotebookEditor) {
        const isJupyterNotebookDoc = e ? e.document.notebookType === JupyterNotebookView : false;
        this.nativeContext.set(isJupyterNotebookDoc).ignoreErrors();

        this.isPythonNotebook
            .set(e && isJupyterNotebookDoc ? isPythonNotebook(getNotebookMetadata(e.document)) : false)
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
        if (activeEditor && activeEditor.document.notebookType === JupyterNotebookView) {
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
    private updateContextOfActiveInteractiveWindowKernel() {
        const interactiveWindow = getActiveInteractiveWindow(this.interactiveProvider);
        if (interactiveWindow?.notebookUri) {
            this.notebookProvider
                .getOrCreateNotebook({
                    identity: interactiveWindow.notebookUri,
                    resource: interactiveWindow.owner,
                    getOnly: true
                })
                .then(async (nb) => {
                    if (
                        getActiveInteractiveWindow(this.interactiveProvider) === interactiveWindow &&
                        nb !== undefined
                    ) {
                        const canStart = nb && nb.status !== ServerStatus.NotStarted;
                        this.canRestartInteractiveWindowKernelContext.set(!!canStart).ignoreErrors();
                        const canInterrupt = nb && nb.status === ServerStatus.Busy;
                        this.canInterruptInteractiveWindowKernelContext.set(!!canInterrupt).ignoreErrors();
                    }
                })
                .catch(
                    traceError.bind(
                        undefined,
                        'Failed to determine if a kernel is active for the current interactive window'
                    )
                );
        } else {
            this.canRestartInteractiveWindowKernelContext.set(false).ignoreErrors();
            this.canInterruptInteractiveWindowKernelContext.set(false).ignoreErrors();
        }
    }
    private onDidKernelStatusChange({ notebook }: { status: ServerStatus; notebook: INotebook }) {
        // Ok, kernel status has changed.
        const activeEditor = this.vscNotebook.activeNotebookEditor;
        const activeInteractiveWindow = getActiveInteractiveWindow(this.interactiveProvider);
        if (
            activeInteractiveWindow &&
            activeInteractiveWindow.notebookUri?.toString() === notebook.identity.toString()
        ) {
            this.updateContextOfActiveInteractiveWindowKernel();
        } else if (activeEditor && activeEditor.document.uri.toString() === notebook.identity.toString()) {
            this.updateContextOfActiveNotebookKernel(activeEditor);
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
