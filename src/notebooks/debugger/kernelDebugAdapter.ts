// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from '../../platform/vscode-path/path';
import { IDumpCellResponse } from '../../kernels/debugger/types';
import { traceError } from '../../platform/logging';
import { KernelDebugAdapterBase } from '../../kernels/debugger/kernelDebugAdapterBase';
import { executeSilently } from '../../kernels/helpers';

export class KernelDebugAdapter extends KernelDebugAdapterBase {
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
            this.cellToFile.set(cell.document.uri, {
                path: norm
            });
        } catch (err) {
            traceError(err);
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
                    return '"' + filePath.path + '"';
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
