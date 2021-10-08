// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { notebooks, NotebookCellExecutionStateChangeEvent, NotebookDocument, NotebookCellExecutionState } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IVSCodeNotebook, IWorkspaceService } from '../../common/application/types';
import { IDisposableRegistry } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { isJupyterNotebook } from '../notebook/helpers/helpers';

/**
 * This class tracks opened notebooks, # of notebooks in workspace & # of executed notebooks.
 */
@injectable()
export class NotebookUsageTracker implements IExtensionSingleActivationService {
    private readonly executedNotebooksIndexedByUri = new Set<string>();
    private notebookCount: number = 0;
    private openedNotebookCount: number = 0;
    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}

    public async activate(): Promise<void> {
        // Look through the file system for ipynb files to see how many we have in the workspace. Don't wait
        // on this though.
        const findFilesPromise = this.workspace.findFiles('**/*.ipynb');
        if (findFilesPromise && findFilesPromise.then) {
            findFilesPromise.then((r) => (this.notebookCount += r.length), noop);
        }
        this.vscNotebook.onDidOpenNotebookDocument(this.onEditorOpened, this, this.disposables);
        this.vscNotebook.onDidChangeNotebookCellExecutionState(
            (e) => {
                if (isJupyterNotebook(e.cell.notebook) && e.state !== NotebookCellExecutionState.Idle) {
                    this.executedNotebooksIndexedByUri.add(e.cell.notebook.uri.fsPath);
                }
            },
            this,
            this.disposables
        );
        notebooks.onDidChangeNotebookCellExecutionState(
            this.onDidChangeNotebookCellExecutionState,
            this,
            this.disposables
        );
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
    private onEditorOpened(doc: NotebookDocument): void {
        if (!isJupyterNotebook(doc)) {
            return;
        }
        this.openedNotebookCount += 1;
        if (doc.isUntitled) {
            this.notebookCount += 1;
        }
    }
    private onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent): void {
        this.executedNotebooksIndexedByUri.add(e.cell.notebook.uri.fsPath);
    }
}
