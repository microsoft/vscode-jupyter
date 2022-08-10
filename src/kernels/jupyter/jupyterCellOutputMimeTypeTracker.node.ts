// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { IDisposable } from '@fluentui/react';
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { NotebookCell, NotebookCellExecutionStateChangeEvent, NotebookCellKind, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposableRegistry } from '../../platform/common/types';
import { isJupyterNotebook } from '../../platform/common/utils';
import { captureTelemetry, sendTelemetryEvent, Telemetry } from '../../telemetry';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { createJupyterCellFromVSCNotebookCell } from '../execution/helpers';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const flatten = require('lodash/flatten') as typeof import('lodash/flatten');

/**
 * Sends telemetry about cell output mime types
 */
@injectable()
export class CellOutputMimeTypeTracker implements IExtensionSingleActivationService, IDisposable {
    private pendingChecks = new Map<string, NodeJS.Timer | number>();
    private sentMimeTypes: Set<string> = new Set<string>();
    private readonly disposables: IDisposable[] = [];

    constructor(
        @inject(IVSCodeNotebook) private vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
        this.vscNotebook.onDidOpenNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        this.vscNotebook.onDidCloseNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        this.vscNotebook.onDidSaveNotebookDocument(this.onDidOpenCloseDocument, this, this.disposables);
        this.vscNotebook.onDidChangeNotebookCellExecutionState(
            this.onDidChangeNotebookCellExecutionState,
            this,
            this.disposables
        );
    }
    public async activate(): Promise<void> {
        //
    }

    public dispose() {
        disposeAllDisposables(this.disposables);
        this.pendingChecks.clear();
    }
    public async onDidChangeNotebookCellExecutionState(e: NotebookCellExecutionStateChangeEvent): Promise<void> {
        if (!isJupyterNotebook(e.cell.notebook)) {
            return;
        }
        this.scheduleCheck(e.cell.document.uri.toString(), this.checkCell.bind(this, e.cell));
    }
    private onDidOpenCloseDocument(doc: NotebookDocument) {
        if (!isJupyterNotebook(doc)) {
            return;
        }
        doc.getCells().forEach((cell) => {
            if (cell.kind === NotebookCellKind.Code) {
                cell.outputs.forEach((output) => output.items.forEach((item) => this.sendTelemetry(item.mime)));
            }
        });
    }
    private getCellOutputMimeTypes(cell: NotebookCell): string[] {
        if (cell.kind === NotebookCellKind.Markup) {
            return ['markdown'];
        }
        if (cell.document.languageId === 'raw') {
            return [];
        }
        const nbCell = createJupyterCellFromVSCNotebookCell(cell);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outputs: nbformat.IOutput[] = (nbCell as any).outputs as any;
        if (!Array.isArray(outputs)) {
            return [];
        }
        if (
            cell.executionSummary?.executionOrder &&
            cell.executionSummary?.executionOrder > 0 &&
            cell.executionSummary?.success
        ) {
            return flatten(outputs.map(this.getOutputMimeTypes.bind(this)));
        }
        return [];
    }
    private getOutputMimeTypes(output: nbformat.IOutput): string[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outputType: nbformat.OutputType = output.output_type as any;
        switch (outputType) {
            case 'error':
                return [];
            case 'stream':
                return ['stream'];
            case 'display_data':
            case 'update_display_data':
            case 'execute_result':
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const data = (output as any).data;
                return data ? Object.keys(data) : [];
            default:
                // If we have a large number of these, then something is wrong.
                return ['unrecognized_cell_output'];
        }
    }

    private scheduleCheck(id: string, check: () => void) {
        // If already scheduled, cancel.
        const currentTimeout = this.pendingChecks.get(id);
        if (currentTimeout) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clearTimeout(currentTimeout as any);
            this.pendingChecks.delete(id);
        }

        // Now schedule a new one.
        // Wait five seconds to make sure we don't already have this document pending.
        this.pendingChecks.set(id, setTimeout(check, 5000));
    }

    @captureTelemetry(Telemetry.HashedCellOutputMimeTypePerf)
    private checkCell(cell: NotebookCell) {
        this.pendingChecks.delete(cell.document.uri.toString());
        this.getCellOutputMimeTypes(cell).forEach(this.sendTelemetry.bind(this));
    }

    private sendTelemetry(mimeType: string) {
        // No need to send duplicate telemetry or waste CPU cycles on an unneeded hash.
        if (this.sentMimeTypes.has(mimeType)) {
            return;
        }
        this.sentMimeTypes.add(mimeType);
        // Hash the package name so that we will never accidentally see a
        // user's private package name.
        const hashedName = getTelemetrySafeHashedString(mimeType);

        const lowerMimeType = mimeType.toLowerCase();
        // The following gives us clues of the mimetype.
        const props = {
            hashedName,
            hasText: lowerMimeType.includes('text'),
            hasLatex: lowerMimeType.includes('latex'),
            hasHtml: lowerMimeType.includes('html'),
            hasSvg: lowerMimeType.includes('svg'),
            hasXml: lowerMimeType.includes('xml'),
            hasJson: lowerMimeType.includes('json'),
            hasImage: lowerMimeType.includes('image'),
            hasGeo: lowerMimeType.includes('geo'),
            hasPlotly: lowerMimeType.includes('plotly'),
            hasVega: lowerMimeType.includes('vega'),
            hasWidget: lowerMimeType.includes('widget'),
            hasJupyter: lowerMimeType.includes('jupyter'),
            hasVnd: lowerMimeType.includes('vnd')
        };
        sendTelemetryEvent(Telemetry.HashedCellOutputMimeType, undefined, props);
    }
}
