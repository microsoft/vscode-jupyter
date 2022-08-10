// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as path from '../../platform/vscode-path/path';
import { IDumpCellResponse } from './debuggingTypes';
import { traceError } from '../../platform/logging';
import { KernelDebugAdapterBase } from './kernelDebugAdapterBase';
import { DebugProtocol } from 'vscode-debugprotocol';

/**
 * Concrete implementation of the KernelDebugAdapterBase class that will dump cells
 */
export class KernelDebugAdapter extends KernelDebugAdapterBase {
    private readonly cellToFile = new Map<string, string>();

    // Dump content of given cell into a tmp file and return path to file.
    protected override async dumpCell(index: number): Promise<void> {
        const cell = this.notebookDocument.cellAt(index);
        try {
            const response = await this.session.customRequest('dumpCell', {
                code: cell.document.getText().replace(/\r\n/g, '\n')
            });
            const norm = path.normalize((response as IDumpCellResponse).sourcePath);
            this.fileToCell.set(norm, cell.document.uri);
            this.cellToFile.set(cell.document.uri.toString(), norm);
        } catch (err) {
            traceError(err);
        }
    }
    protected translateRealFileToDebuggerFile(
        source: DebugProtocol.Source | undefined,
        _lines?: { line?: number; endLine?: number; lines?: number[] }
    ) {
        if (source && source.path) {
            const mapping = this.cellToFile.get(source.path);
            if (mapping) {
                source.path = mapping;
            }
        }
    }

    protected getDumpFilesForDeletion() {
        return Array.from(this.cellToFile.values());
    }
}
