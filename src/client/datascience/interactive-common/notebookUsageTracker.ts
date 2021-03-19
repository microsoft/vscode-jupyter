// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EventEmitter, notebook, NotebookCellExecutionStateChangeEvent } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IWorkspaceService } from '../../common/application/types';
import { IDisposableRegistry } from '../../common/types';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { INotebookEditor, INotebookEditorProvider } from '../types';

/**
 * This class tracks opened notebooks, # of notebooks in workspace & # of executed notebooks.
 */
@injectable()
export class NotebookUsageTracker implements IExtensionSingleActivationService {
    protected readonly _onDidChangeActiveNotebookEditor = new EventEmitter<INotebookEditor | undefined>();
    protected readonly _onDidOpenNotebookEditor = new EventEmitter<INotebookEditor>();
    private readonly executedNotebooksIndexedByUri = new Set<string>();
    private notebookCount: number = 0;
    private openedNotebookCount: number = 0;
    constructor(
        @inject(INotebookEditorProvider) private readonly editorProvider: INotebookEditorProvider,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}

    public async activate(): Promise<void> {
        // Look through the file system for ipynb files to see how many we have in the workspace. Don't wait
        // on this though.
        const findFilesPromise = this.workspace.findFiles('**/*.ipynb');
        if (findFilesPromise && findFilesPromise.then) {
            findFilesPromise.then((r) => (this.notebookCount += r.length));
        }
        this.editorProvider.onDidOpenNotebookEditor(this.onEditorOpened, this, this.disposables);
        notebook.onDidChangeCellExecutionState(this.onDidChangeCellExecutionState, this, this.disposables);
    }
    public dispose() {
        // Send a bunch of telemetry
        if (this.openedNotebookCount) {
            sendTelemetryEvent(Telemetry.NotebookOpenCount, undefined, { count: this.openedNotebookCount });
        }
        if (this.executedNotebooksIndexedByUri.size) {
            sendTelemetryEvent(Telemetry.NotebookRunCount, undefined, {
                count: this.executedNotebooksIndexedByUri.size
            });
        }
        if (this.notebookCount) {
            sendTelemetryEvent(Telemetry.NotebookWorkspaceCount, undefined, { count: this.notebookCount });
        }
    }
    private onEditorOpened(editor: INotebookEditor): void {
        this.openedNotebookCount += 1;
        if (editor.model?.isUntitled) {
            this.notebookCount += 1;
        }
        if (!this.executedNotebooksIndexedByUri.has(editor.file.fsPath) && editor.executed) {
            editor.executed((e) => this.executedNotebooksIndexedByUri.add(e.file.fsPath), this, this.disposables);
        }
    }
    private onDidChangeCellExecutionState(e: NotebookCellExecutionStateChangeEvent): void {
        this.executedNotebooksIndexedByUri.add(e.cell.notebook.uri.fsPath);
    }
}
