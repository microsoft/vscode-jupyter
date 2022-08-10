// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { notebooks, NotebookCellExecutionStateChangeEvent, NotebookDocument, NotebookCellExecutionState } from 'vscode';
import { IExtensionSingleActivationService } from '../platform/activation/types';
import { IVSCodeNotebook } from '../platform/common/application/types';
import { IDisposableRegistry } from '../platform/common/types';
import { isJupyterNotebook } from '../platform/common/utils';
import { ResourceSet } from '../platform/vscode-path/map';
import { sendTelemetryEvent, Telemetry } from '../telemetry';

/**
 * This class tracks opened notebooks & # of executed notebooks.
 */
@injectable()
export class NotebookUsageTracker implements IExtensionSingleActivationService {
    private readonly executedNotebooksIndexedByUri = new ResourceSet();
    private openedNotebookCount: number = 0;
    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}

    public async activate(): Promise<void> {
        this.vscNotebook.onDidOpenNotebookDocument(this.onEditorOpened, this, this.disposables);
        this.vscNotebook.onDidChangeNotebookCellExecutionState(
            (e) => {
                if (isJupyterNotebook(e.cell.notebook) && e.state !== NotebookCellExecutionState.Idle) {
                    this.executedNotebooksIndexedByUri.add(e.cell.notebook.uri);
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
    }
    private onEditorOpened(doc: NotebookDocument): void {
        if (!isJupyterNotebook(doc)) {
            return;
        }
        this.openedNotebookCount += 1;
    }
    private onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent): void {
        this.executedNotebooksIndexedByUri.add(e.cell.notebook.uri);
    }
}
