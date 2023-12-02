// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    NotebookCell,
    NotebookCellExecutionStateChangeEvent,
    NotebookCellKind,
    NotebookDocument,
    notebooks,
    workspace
} from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { JupyterNotebookView } from '../../platform/common/constants';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { isJupyterNotebook } from '../../platform/common/utils';
import { ResourceTypeTelemetryProperty, sendTelemetryEvent, Telemetry } from '../../telemetry';
import { isTelemetryDisabled } from '../../telemetry';

/**
 * Sends telemetry about cell output mime types
 */
@injectable()
export class CellOutputMimeTypeTracker implements IExtensionSyncActivationService, IDisposable {
    private sentMimeTypes: Set<string> = new Set<string>();
    private readonly disposables: IDisposable[] = [];
    private get isTelemetryDisabled() {
        return isTelemetryDisabled();
    }

    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        disposables.push(this);
    }
    public activate() {
        workspace.onDidOpenNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        workspace.onDidCloseNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        workspace.onDidSaveNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        notebooks.onDidChangeNotebookCellExecutionState(
            this.onDidChangeNotebookCellExecutionState,
            this,
            this.disposables
        );
    }

    public dispose() {
        dispose(this.disposables);
    }
    public async onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent): Promise<void> {
        if (!isJupyterNotebook(e.cell.notebook) || this.isTelemetryDisabled) {
            return;
        }
        this.checkCell(e.cell, 'onExecution');
    }
    private onDidOpenCloseDocument(doc: NotebookDocument) {
        if (!isJupyterNotebook(doc) || this.isTelemetryDisabled) {
            return;
        }
        doc.getCells().forEach((cell) => this.checkCell(cell, 'onOpenCloseOrSave'));
    }
    private checkCell(cell: NotebookCell, when: 'onExecution' | 'onOpenCloseOrSave') {
        if (cell.kind === NotebookCellKind.Markup) {
            return;
        }
        if (cell.document.languageId === 'raw') {
            return;
        }
        const resourceType = cell.notebook.notebookType === JupyterNotebookView ? 'notebook' : 'interactive';
        cell.outputs
            .map((output) => output.items.map((item) => item.mime))
            .flat()
            .map((mime) => this.sendTelemetry(mime, when, resourceType));
    }

    private sendTelemetry(
        mimeType: string,
        when: 'onExecution' | 'onOpenCloseOrSave',
        resourceType: ResourceTypeTelemetryProperty['resourceType']
    ) {
        // No need to send duplicate telemetry or waste CPU cycles on an unneeded hash.
        const key = `${mimeType}-${when}`;
        if (this.sentMimeTypes.has(key)) {
            return;
        }
        this.sentMimeTypes.add(key);
        // The telemetry reporter assumes the presence of a `/` or `\` indicates these are file paths
        // and obscures them. We don't want that, so we replace them with `_`.
        mimeType = mimeType.replace(/\//g, '_').replace(/\\/g, '_');
        sendTelemetryEvent(Telemetry.CellOutputMimeType, undefined, { mimeType, when, resourceType });
    }
}
