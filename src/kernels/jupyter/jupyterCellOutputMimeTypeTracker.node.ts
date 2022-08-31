// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IDisposable } from '@fluentui/react';
import { inject, injectable } from 'inversify';
import { NotebookCell, NotebookCellExecutionStateChangeEvent, NotebookCellKind, NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposableRegistry } from '../../platform/common/types';
import { isJupyterNotebook } from '../../platform/common/utils';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const flatten = require('lodash/flatten') as typeof import('lodash/flatten');

/**
 * Sends telemetry about cell output mime types
 */
@injectable()
export class CellOutputMimeTypeTracker implements IExtensionSyncActivationService, IDisposable {
    private sentMimeTypes: Set<string> = new Set<string>();
    private readonly disposables: IDisposable[] = [];

    constructor(
        @inject(IVSCodeNotebook) private vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
    }
    public activate() {
        this.vscNotebook.onDidOpenNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        this.vscNotebook.onDidCloseNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        this.vscNotebook.onDidSaveNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        this.vscNotebook.onDidChangeNotebookCellExecutionState(
            this.onDidChangeNotebookCellExecutionState,
            this,
            this.disposables
        );
    }

    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public async onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent): Promise<void> {
        if (!isJupyterNotebook(e.cell.notebook)) {
            return;
        }
        this.checkCell(e.cell);
    }
    private onDidOpenCloseDocument(doc: NotebookDocument) {
        if (!isJupyterNotebook(doc)) {
            return;
        }
        doc.getCells().forEach((cell) => this.checkCell(cell));
    }
    private checkCell(cell: NotebookCell) {
        if (cell.kind === NotebookCellKind.Markup) {
            return [];
        }
        if (cell.document.languageId === 'raw') {
            return [];
        }
        return flatten(cell.outputs.map((output) => output.items.map((item) => item.mime))).forEach(
            this.sendTelemetry.bind(this)
        );
    }

    private sendTelemetry(mimeType: string) {
        // No need to send duplicate telemetry or waste CPU cycles on an unneeded hash.
        if (this.sentMimeTypes.has(mimeType)) {
            return;
        }
        this.sentMimeTypes.add(mimeType);
        sendTelemetryEvent(Telemetry.CellOutputMimeType, undefined, { mimeType });
    }
}
