// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import '../../common/extensions';
import { IFileSystem } from '../../common/platform/types';
import { IDisposableRegistry } from '../../common/types';
import { KernelState, KernelStateEventArgs } from '../notebookExtensibility';
import { INotebook, INotebookEditor, INotebookEditorProvider, INotebookExtensibility } from '../types';
import { INotebookWatcher } from './types';

// For any class that is monitoring the active notebook document, this class will update you
// when the active notebook changes or if the execution count is updated on the active notebook
// NOTE: Currently this class is only looking at native notebook documents
@injectable()
export class NotebookWatcher implements INotebookWatcher {
    //public get onDidChangeActiveVariableViewNotebook(): Event<INotebook | undefined> {
    public get onDidChangeActiveVariableViewNotebook(): Event<{ notebook?: INotebook; executionCount?: number }> {
        return this._onDidChangeActiveVariableViewNotebook.event;
    }
    public get onDidExecuteActiveVariableViewNotebook(): Event<{ executionCount: number }> {
        return this._onDidExecuteActiveVariableViewNotebook.event;
    }
    public get onDidRestartActiveVariableViewNotebook(): Event<void> {
        return this._onDidRestartActiveVariableViewNotebook.event;
    }
    public get activeVariableViewNotebook(): INotebook | undefined {
        return this._activeEditor?.notebook;
        //return this.notebookEditorProvider.activeEditor?.notebook; // IANHU: Maybe can restore this?
    }

    private _activeEditor: INotebookEditor | undefined;
    private readonly _onDidExecuteActiveVariableViewNotebook = new EventEmitter<{ executionCount: number }>();
    //private readonly _onDidChangeActiveVariableViewNotebook = new EventEmitter<INotebook | undefined>();
    private readonly _onDidChangeActiveVariableViewNotebook = new EventEmitter<{
        notebook?: INotebook;
        executionCount?: number;
    }>();
    private readonly _onDidRestartActiveVariableViewNotebook = new EventEmitter<void>();

    // Keep track of the execution count for any editors
    // IANHU: This uses ToString on the URIs. Convert to a list that we add and replace into?
    //private readonly _executionCountMap: Map<Uri, number> = new Map<Uri, number>();
    private readonly _executionCountMap: Map<string, number> = new Map<string, number>();

    constructor(
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(INotebookExtensibility) private readonly notebookExtensibility: INotebookExtensibility,
        @inject(IFileSystem) private readonly fileSystem: IFileSystem,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        // We need to know if kernel state changes or if the active notebook editor is changed
        this.notebookExtensibility.onKernelStateChange(this.kernelStateChanged, this, this.disposables);
        this.notebookEditorProvider.onDidChangeActiveNotebookEditor(this.activeEditorChanged, this, this.disposables);
        this.notebookEditorProvider.onDidCloseNotebookEditor(this.notebookEditorClosed, this, this.disposables);
        this._activeEditor = this.notebookEditorProvider.activeEditor; // Make sure that we assign an initial editor
    }

    // When the kernel state is changed we need to see if it's a cell from the active document that finished execution
    // If so update the execution count on the variable view to refresh variables
    private async kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        // Update execution counts for any non-silent executions that we get
        if (this.isNonSilentExecution(kernelStateEvent)) {
            this.updateExecutionCounts(kernelStateEvent);
        }

        // Update our execution counts for restarts
        if (this.isRestart(kernelStateEvent)) {
            if (this._executionCountMap.has(kernelStateEvent.resource.toString())) {
                this._executionCountMap.delete(kernelStateEvent.resource.toString());
            }
        }

        // Check to see if we need to notify for the active editor document being executed or restarted
        if (
            this.isActiveNotebookExecution(kernelStateEvent) &&
            kernelStateEvent.cell &&
            kernelStateEvent.cell.metadata.executionOrder
        ) {
            // Notify any listeners that the active notebook has updated execution order
            this._onDidExecuteActiveVariableViewNotebook.fire({
                executionCount: kernelStateEvent.cell.metadata.executionOrder
            });
        } else if (this.isActiveNotebookRestart(kernelStateEvent)) {
            // Clear our execution count tracking on restart
            if (this._executionCountMap.has(kernelStateEvent.resource.toString())) {
                this._executionCountMap.delete(kernelStateEvent.resource.toString());
            }
            this._onDidRestartActiveVariableViewNotebook.fire();
        }
    }

    // When an editor is closed, remove it from our execution count map
    private notebookEditorClosed(editor: INotebookEditor) {
        if (this._executionCountMap.has(editor.file.toString())) {
            this._executionCountMap.delete(editor.file.toString());
        }
    }

    // IANHU: Not Async?
    private async activeEditorChanged(editor: INotebookEditor | undefined) {
        // When the active editor changes we want to force a refresh of variables
        //this._activeEditor = editor;
        //this._onDidChangeActiveVariableViewNotebook.fire(this._activeEditor?.notebook);
        //this._onDidChangeActiveVariableViewNotebook.fire(editor?.notebook);

        const changeEvent: { notebook?: INotebook; executionCount?: number } = {};

        // First save our active editor
        this._activeEditor = editor;

        if (editor) {
            changeEvent.notebook = editor.notebook;
            if (this._executionCountMap.has(editor.file.toString())) {
                changeEvent.executionCount = this._executionCountMap.get(editor.file.toString());
            }
        }

        this._onDidChangeActiveVariableViewNotebook.fire(changeEvent);
    }

    private isRestart(kernelStateEvent: KernelStateEventArgs): boolean {
        if (kernelStateEvent.state === KernelState.restarted) {
            return true;
        }

        return false;
    }

    private isNonSilentExecution(kernelStateEvent: KernelStateEventArgs): boolean {
        if (
            kernelStateEvent.state === KernelState.executed &&
            kernelStateEvent.cell &&
            kernelStateEvent.cell.metadata.executionOrder &&
            !kernelStateEvent.silent
        ) {
            return true;
        }

        return false;
    }

    private updateExecutionCounts(kernelStateEvent: KernelStateEventArgs) {
        if (kernelStateEvent.cell?.metadata.executionOrder) {
            this._executionCountMap.set(
                kernelStateEvent.resource.toString(),
                kernelStateEvent.cell?.metadata.executionOrder
            );
        }
    }

    private isActiveNotebookExecution(kernelStateEvent: KernelStateEventArgs): boolean {
        if (
            kernelStateEvent.state === KernelState.executed &&
            kernelStateEvent.cell &&
            kernelStateEvent.cell.metadata.executionOrder &&
            !kernelStateEvent.silent
        ) {
            // We only want to update the variable view execution count when it's the active document executing
            if (
                //this.notebookEditorProvider.activeEditor &&
                //this.fileSystem.arePathsSame(this.notebookEditorProvider.activeEditor.file, kernelStateEvent.resource)
                this._activeEditor &&
                this.fileSystem.arePathsSame(this._activeEditor.file, kernelStateEvent.resource)
            ) {
                return true;
            }
        }

        return false;
    }

    private isActiveNotebookRestart(kernelStateEvent: KernelStateEventArgs): boolean {
        if (
            kernelStateEvent.state == KernelState.restarted &&
            //this.notebookEditorProvider.activeEditor &&
            //this.fileSystem.arePathsSame(this.notebookEditorProvider.activeEditor.file, kernelStateEvent.resource)
            this._activeEditor &&
            this.fileSystem.arePathsSame(this._activeEditor.file, kernelStateEvent.resource)
        ) {
            return true;
        }
        return false;
    }
}
