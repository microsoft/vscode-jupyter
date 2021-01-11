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
import { IVariableViewNotebookWatcher } from './types';

@injectable()
export class VariableViewNotebookWatcher implements IVariableViewNotebookWatcher {
    //public readonly activeVariableViewNotebook?: INotebook | undefined;
    //public readonly onDidChangeActiveVariableViewNotebook: Event<INotebook>;
    //public readonly onDidExecuteActiveVariableViewNotebook: Event<{ executionCount: number }>;
    //protected readonly _onDidChangeActiveNotebookEditor = new EventEmitter<INotebookEditor | undefined>();
    //protected readonly _onDidOpenNotebookEditor = new EventEmitter<INotebookEditor>();
    public get onDidChangeActiveVariableViewNotebook(): Event<INotebook | undefined> {
        return this._onDidChangeActiveVariableViewNotebook.event;
    }
    public get onDidExecuteActiveVariableViewNotebook(): Event<{ executionCount: number }> {
        return this._onDidExecuteActiveVariableViewNotebook.event;
    }
    public get activeVariableViewNotebook(): INotebook | undefined {
        return this.notebookEditorProvider.activeEditor?.notebook;
    }

    private readonly _onDidExecuteActiveVariableViewNotebook = new EventEmitter<{ executionCount: number }>();
    private readonly _onDidChangeActiveVariableViewNotebook = new EventEmitter<INotebook | undefined>();

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
            kernelStateEvent.silent !== true
        ) {
            // We only want to update the variable view execution count when it's the active document executing
            if (
                this.notebookEditorProvider.activeEditor &&
                this.fileSystem.arePathsSame(this.notebookEditorProvider.activeEditor.file, kernelStateEvent.resource)
            ) {
                // Notify any listeners that the active notebook has updated execution order
                this._onDidExecuteActiveVariableViewNotebook.fire({
                    executionCount: kernelStateEvent.cell.metadata.executionOrder
                });
            }
        }
    }

    private async activeEditorChanged(editor: INotebookEditor | undefined) {
        // When the active editor changes we want to force a refresh of variables
        this._onDidChangeActiveVariableViewNotebook.fire(editor?.notebook);
    }
}
