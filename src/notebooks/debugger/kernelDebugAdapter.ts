// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from '../../platform/vscode-path/path';
import { NotebookCellKind } from 'vscode';
import { IDumpCellResponse } from '../../kernels/debugger/types';
import { traceError } from '../../platform/logging';
import { KernelDebugAdapterBase } from '../../kernels/debugger/kernelDebugAdapterBase';

export class KernelDebugAdapter extends KernelDebugAdapterBase {
    public override async dumpAllCells() {
        await Promise.all(
            this.notebookDocument.getCells().map(async (cell) => {
                if (cell.kind === NotebookCellKind.Code) {
                    await this.dumpCell(cell.index);
                }
            })
        );
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
}
