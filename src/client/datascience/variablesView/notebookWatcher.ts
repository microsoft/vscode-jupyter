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
    public get onDidChangeActiveNotebook(): Event<IActiveNotebookChangedEvent> {
        return this._onDidChangeActiveNotebook.event;
    }
    public get onDidExecuteActiveNotebook(): Event<{ executionCount: number }> {
        return this._onDidExecuteActiveNotebook.event;
    }
    public get onDidRestartActiveNotebook(): Event<void> {
        return this._onDidRestartActiveNotebook.event;
    }
    public get activeNotebook(): INotebook | undefined {
        return this.notebookEditorProvider.activeEditor?.notebook;
    }

    private readonly _onDidExecuteActiveNotebook = new EventEmitter<{ executionCount: number }>();
    private readonly _onDidChangeActiveNotebook = new EventEmitter<{
        notebook?: INotebook;
        executionCount?: number;
    }>();
    private readonly _onDidRestartActiveNotebook = new EventEmitter<void>();

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

    // Handle kernel state changes
    private kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        switch (kernelStateEvent.state) {
            case KernelState.executed:
                this.handleExecute(kernelStateEvent);
                break;
            case KernelState.restarted:
                this.handleRestart(kernelStateEvent);
                break;
            default:
                break;
        }
    }

    // Handle a kernel execution event
    private handleExecute(kernelStateEvent: KernelStateEventArgs) {
        // We are not interested in silent executions
        if (this.isNonSilentExecution(kernelStateEvent)) {
            // First, update our execution counts, regardless of if this is the active document
            if (kernelStateEvent.cell?.metadata.executionOrder !== undefined) {
                this.updateExecutionCount(kernelStateEvent.resource, kernelStateEvent.cell.metadata.executionOrder);
            }

            // Next, if this is the active document, send out our notifications
            if (
                //this.isActiveNotebookExecution(kernelStateEvent) &&
                this.isActiveNotebookEvent(kernelStateEvent) &&
                kernelStateEvent.cell?.metadata.executionOrder !== undefined
            ) {
                this._onDidExecuteActiveNotebook.fire({
                    executionCount: kernelStateEvent.cell.metadata.executionOrder
                });
            }
        }
    }

    // Handle a kernel restart event
    private handleRestart(kernelStateEvent: KernelStateEventArgs) {
        // First delete any execution counts that we are holding for this
        this.deleteExecutionCount(kernelStateEvent.resource);

        // If this is the active notebook, send our restart message
        //if (this.isActiveNotebookRestart(kernelStateEvent)) {
        if (this.isActiveNotebookEvent(kernelStateEvent)) {
            this._onDidRestartActiveNotebook.fire();
        }
    }

    // When an editor is closed, remove it from our execution count map
    private notebookEditorClosed(editor: INotebookEditor) {
        this.deleteExecutionCount(editor.file);
    }

    // When the active editor is changed, update our execution count and notify
    private activeEditorChanged(editor: INotebookEditor | undefined) {
        const changeEvent: IActiveNotebookChangedEvent = {};

        if (editor) {
            changeEvent.notebook = editor.notebook;
            const executionCount = this.getExecutionCount(editor.file);
            executionCount && (changeEvent.executionCount = executionCount.executionCount);
        }

        this._onDidChangeActiveNotebook.fire(changeEvent);
    }

    // Check to see if this is a non-silent execution that we want to update on
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

    // Check to see if this event was on the active notebook
    private isActiveNotebookEvent(kernelStateEvent: KernelStateEventArgs): boolean {
        if (
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
