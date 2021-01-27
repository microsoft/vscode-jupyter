// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { Event, EventEmitter, Uri } from 'vscode';
import '../../common/extensions';
import { IFileSystem } from '../../common/platform/types';
import { IDisposableRegistry } from '../../common/types';
import { KernelState, KernelStateEventArgs } from '../notebookExtensibility';
import { INotebook, INotebookEditor, INotebookEditorProvider, INotebookExtensibility } from '../types';
import { IActiveNotebookChangedEvent, INotebookWatcher } from './types';

interface IExecutionCountEntry {
    uri: Uri;
    executionCount: number;
}

// For any class that is monitoring the active notebook document, this class will update you
// when the active notebook changes or if the execution count is updated on the active notebook
// NOTE: Currently this class is only looking at native notebook documents
@injectable()
export class NotebookWatcher implements INotebookWatcher {
    public get onDidChangeActiveVariableViewNotebook(): Event<IActiveNotebookChangedEvent> {
        return this._onDidChangeActiveVariableViewNotebook.event;
    }
    public get onDidExecuteActiveVariableViewNotebook(): Event<{ executionCount: number }> {
        return this._onDidExecuteActiveVariableViewNotebook.event;
    }
    public get onDidRestartActiveVariableViewNotebook(): Event<void> {
        return this._onDidRestartActiveVariableViewNotebook.event;
    }
    public get activeVariableViewNotebook(): INotebook | undefined {
        return this.notebookEditorProvider.activeEditor?.notebook;
    }

    private readonly _onDidExecuteActiveVariableViewNotebook = new EventEmitter<{ executionCount: number }>();
    private readonly _onDidChangeActiveVariableViewNotebook = new EventEmitter<{
        notebook?: INotebook;
        executionCount?: number;
    }>();
    private readonly _onDidRestartActiveVariableViewNotebook = new EventEmitter<void>();

    // Keep track of the execution count for any editors
    private _executionCountTracker: IExecutionCountEntry[] = [];

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
    }

    // When the kernel state is changed we need to see if it's a cell from the active document that finished execution
    // If so update the execution count on the variable view to refresh variables
    private kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        // Update execution counts for any non-silent executions that we get
        if (this.isNonSilentExecution(kernelStateEvent)) {
            this.updateExecutionCounts(kernelStateEvent);
        }

        // Update our execution counts for restarts
        if (this.isRestart(kernelStateEvent)) {
            this.deleteExecutionCount(kernelStateEvent.resource);
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
            this._onDidRestartActiveVariableViewNotebook.fire();
        }
    }

    // When an editor is closed, remove it from our execution count map
    private notebookEditorClosed(editor: INotebookEditor) {
        this.deleteExecutionCount(editor.file);
    }

    private activeEditorChanged(editor: INotebookEditor | undefined) {
        const changeEvent: IActiveNotebookChangedEvent = {};

        if (editor) {
            changeEvent.notebook = editor.notebook;
            const executionCount = this.getExecutionCount(editor.file);
            executionCount && (changeEvent.executionCount = executionCount.executionCount);
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
            this.updateExecutionCount(kernelStateEvent.resource, kernelStateEvent.cell.metadata.executionOrder);
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
                this.notebookEditorProvider.activeEditor &&
                this.fileSystem.arePathsSame(this.notebookEditorProvider.activeEditor.file, kernelStateEvent.resource)
            ) {
                return true;
            }
        }

        return false;
    }

    private isActiveNotebookRestart(kernelStateEvent: KernelStateEventArgs): boolean {
        if (
            kernelStateEvent.state == KernelState.restarted &&
            this.notebookEditorProvider.activeEditor &&
            this.fileSystem.arePathsSame(this.notebookEditorProvider.activeEditor.file, kernelStateEvent.resource)
        ) {
            return true;
        }
        return false;
    }

    // If the Uri is in the execution count tracker, return it, if not return undefined
    private getExecutionCount(uri: Uri): IExecutionCountEntry | undefined {
        return this._executionCountTracker.find((value) => {
            return this.fileSystem.arePathsSame(uri, value.uri);
        });
    }

    // Update the execution count value for the given Uri
    private updateExecutionCount(uri: Uri, newValue: number) {
        const executionCount = this.getExecutionCount(uri);
        if (!executionCount) {
            // If we don't have one yet, add one
            this._executionCountTracker.push({ uri, executionCount: newValue });
        } else {
            executionCount.executionCount = newValue;
        }
    }

    // Delete the given Uri from our execution count list
    private deleteExecutionCount(uri: Uri) {
        this._executionCountTracker = this._executionCountTracker.filter((value) => {
            return !this.fileSystem.arePathsSame(uri, value.uri);
        });
    }
}
