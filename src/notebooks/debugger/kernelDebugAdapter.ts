// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DebugProtocol } from 'vscode-debugprotocol';
import { logger } from '../../platform/logging';
import * as path from '../../platform/vscode-path/path';
import { IDumpCellResponse } from './debuggingTypes';
import { KernelDebugAdapterBase } from './kernelDebugAdapterBase';
import type { NotebookCell } from 'vscode';

/**
 * Concrete implementation of the KernelDebugAdapterBase class that will dump cells
 */
export class KernelDebugAdapter extends KernelDebugAdapterBase {
    private readonly cellToFile = new Map<string, string>();
    private readonly lineOffsets = new WeakMap<NotebookCell, number>();

    // Dump content of given cell into a tmp file and return path to file.
    protected override async dumpCell(index: number): Promise<void> {
        const cell = this.notebookDocument.cellAt(index);
        try {
            const response = await this.session.customRequest('dumpCell', {
                code: cell.document.getText().replace(/\r\n/g, '\n')
            });
            const norm = (response as IDumpCellResponse).sourcePath;
            this.fileToCell.set(norm, cell.document.uri);
            this.cellToFile.set(cell.document.uri.toString(), norm);

            // If there are empty lines, then ipykernel will strip leading empty lines.
            // Take that offset into account when mapping back the stack trace and the like.
            this.lineOffsets.set(cell, getNumberOfStrippedLeadingLines(cell));
        } catch (err) {
            logger.error(err);
        }
    }

    protected override translateDebuggerLocationToRealLocation(
        location: {
            source?: DebugProtocol.Source;
            line?: number;
            endLine?: number;
        },
        source?: DebugProtocol.Source
    ) {
        source = location?.source ?? source;
        if (!source?.path || !this.fileToCell.size) {
            return;
        }
        const mapping = this.fileToCell.get(source.path) ?? this.lookupCellByLongName(source.path);
        if (!mapping) {
            return;
        }
        const cell = this.notebookDocument.getCells().find((c) => c.document.uri.toString() === mapping.toString());
        const offset = cell ? this.lineOffsets.get(cell) ?? 0 : 0;
        source.name = path.basename(mapping.path);
        source.path = mapping.toString();
        if (offset && typeof location?.endLine === 'number') {
            location.endLine = location.endLine + offset;
        }
        if (offset && typeof location?.line === 'number') {
            location.line = location.line + offset;
        }
    }

    protected translateRealLocationToDebuggerLocation(
        location: {
            source?: DebugProtocol.Source;
            line?: number;
            endLine?: number;
        },
        source?: DebugProtocol.Source
    ): void {
        source = location?.source ?? source;
        if (!source?.path || !this.cellToFile.size) {
            return;
        }
        const mapping = this.cellToFile.get(source.path);
        if (!mapping) {
            return;
        }
        const cell = this.notebookDocument.getCells().find((c) => c.document.uri.toString() === source.path);
        const offset = cell ? this.lineOffsets.get(cell) ?? 0 : 0;
        source.path = mapping;
        if (offset && typeof location.line === 'number') {
            if (location.line < offset) {
                location.line = offset;
            } else if (location.line > offset) {
                location.line -= offset;
            }
        }
        if (offset && typeof location.endLine === 'number') {
            if (location.endLine < offset) {
                location.endLine = offset;
            } else if (location.endLine > offset) {
                location.endLine -= offset;
            }
        }
    }

    protected getDumpFilesForDeletion() {
        return Array.from(this.cellToFile.values());
    }
}

function getNumberOfStrippedLeadingLines(cell: NotebookCell): number {
    for (let i = 0; i < cell.document.lineCount; i += 1) {
        if (cell.document.lineAt(i).text.trim().length > 0) {
            return i;
        }
    }
    return 0;
}
