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
    public get onDidChangeActiveNotebook(): Event<INotebook | undefined> {
        return this._onDidChangeActiveNotebook.event;
    }
    public get onDidExecuteActiveNotebook(): Event<{ executionCount: number }> {
        return this._onDidExecuteActiveNotebook.event;
    }
    public get onDidRestartActiveNotebook(): Event<void> {
        return this._onDidRestart.event;
    }
    public get activeNotebook(): INotebook | undefined {
        return this.notebookEditorProvider.activeEditor?.notebook;
    }

    private readonly _onDidExecuteActiveNotebook = new EventEmitter<{ executionCount: number }>();
    private readonly _onDidChangeActiveNotebook = new EventEmitter<INotebook | undefined>();
    private readonly _onDidRestart = new EventEmitter<void>();

    constructor(
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(INotebookExtensibility) private readonly notebookExtensibility: INotebookExtensibility,
        @inject(IFileSystem) private readonly fileSystem: IFileSystem,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        // We need to know if kernel state changes or if the active notebook editor is changed
        this.notebookExtensibility.onKernelStateChange(this.kernelStateChanged, this, this.disposables);
        this.notebookEditorProvider.onDidChangeActiveNotebookEditor(this.activeEditorChanged, this, this.disposables);
    }

    // When the kernel state is changed we need to see if it's a cell from the active document that finished execution
    // If so update the execution count on the variable view to refresh variables
    private async kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        // Check for non-silent executes from the current cell that have an execution order
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
                // Notify any listeners that the active notebook has updated execution order
                this._onDidExecuteActiveNotebook.fire({
                    executionCount: kernelStateEvent.cell.metadata.executionOrder
                });
            }
        } else if (kernelStateEvent.state === KernelState.restarted) {
            this._onDidRestart.fire();
        }
    }

    private async activeEditorChanged(editor: INotebookEditor | undefined) {
        // When the active editor changes we want to force a refresh of variables
        this._onDidChangeActiveNotebook.fire(editor?.notebook);
    }
}
