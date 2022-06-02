// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from '../../platform/vscode-path/path';
import { IDumpCellResponse } from '../../kernels/debugger/types';
import { traceError } from '../../platform/logging';
import { KernelDebugAdapterBase } from '../../kernels/debugger/kernelDebugAdapterBase';
import { executeSilently } from '../../kernels/helpers';
import { DebugProtocol } from 'vscode-debugprotocol';

export class KernelDebugAdapter extends KernelDebugAdapterBase {
    protected readonly cellToFile = new Map<
        string,
        {
            path: string;
            lineOffset?: number;
        }
    >();
    public override dispose() {
        super.dispose();
        // On dispose, delete our temp cell files
        this.deleteDumpCells().catch(() => {
            traceError('Error deleting temporary debug files.');
        });
    }

    // Dump content of given cell into a tmp file and return path to file.
    protected override async dumpCell(index: number): Promise<void> {
        const cell = this.notebookDocument.cellAt(index);
        try {
            const response = await this.session.customRequest('dumpCell', {
                code: cell.document.getText().replace(/\r\n/g, '\n')
            });
            const norm = path.normalize((response as IDumpCellResponse).sourcePath);
            this.fileToCell.set(norm, {
                uri: cell.document.uri
            });
            this.cellToFile.set(cell.document.uri.toString(), {
                path: norm
            });
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
                source.path = mapping.path;
            }
        }
    }

    // Use our jupyter session to delete all the cells
    private async deleteDumpCells() {
        const fileValues = [...this.cellToFile.values()];
        // Need to have our Jupyter Session and some dumpCell files to delete
        if (this.jupyterSession && fileValues.length) {
            // Create our python string of file names
            const fileListString = fileValues
                .map((filePath) => {
                    // escape Windows path separators again for python
                    return '"' + filePath.path.replace(/\\/g, '\\\\') + '"';
                })
                .join(',');

            // Insert into our delete snippet
            const deleteFilesCode = `import os
_VSCODE_fileList = [${fileListString}]
for file in _VSCODE_fileList:
    try:
        os.remove(file)
    except:
        pass
del _VSCODE_fileList`;

            return executeSilently(this.jupyterSession, deleteFilesCode, {
                traceErrors: true,
                traceErrorsMessage: 'Error deleting temporary debugging files'
            });
        }
    }
}
