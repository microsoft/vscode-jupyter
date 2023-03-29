// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    NotebookCell,
    NotebookCellData,
    NotebookDocument,
    NotebookCellKind,
    NotebookEdit,
    Range,
    NotebookRange
} from 'vscode';
import { chainWithPendingUpdates } from '../kernels/execution/notebookUpdater';
import { MARKDOWN_LANGUAGE } from '../platform/common/constants';
import { getDisplayNameOrNameOfKernelConnection } from '../kernels/helpers';
import { SysInfoReason } from '../messageTypes';
import { DataScience } from '../platform/common/utils/localize';
import { KernelConnectionMetadata } from '../kernels/types';

export function getSysInfoMessage(kernelMetadata: KernelConnectionMetadata, reason: SysInfoReason) {
    const displayName = getDisplayNameOrNameOfKernelConnection(kernelMetadata);
    return reason === SysInfoReason.Restart
        ? displayName
            ? DataScience.restartingKernelCustomHeader(displayName)
            : DataScience.restartingKernelHeader
        : displayName
        ? DataScience.startingNewKernelCustomHeader(displayName)
        : DataScience.startingNewKernelHeader;
}

export class SystemInfoCell {
    private sysInfoCellPromise: Promise<NotebookCell>;
    private isDeleted = false;

    constructor(private readonly notebookDocument: NotebookDocument, message: string) {
        this.sysInfoCellPromise = this.createCell(message);
    }

    private async createCell(message: string) {
        let addedCellIndex: number | undefined;
        await chainWithPendingUpdates(this.notebookDocument, (edit) => {
            const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
            markdownCell.metadata = { isInteractiveWindowMessageCell: true };
            addedCellIndex = this.notebookDocument.cellCount;
            const nbEdit = NotebookEdit.insertCells(addedCellIndex, [markdownCell]);
            edit.set(this.notebookDocument.uri, [nbEdit]);
        });
        addedCellIndex = addedCellIndex ?? this.notebookDocument.cellCount - 1;
        return this.notebookDocument.cellAt(addedCellIndex);
    }

    public async updateMessage(newMessage: string) {
        const cell = await this.sysInfoCellPromise;
        await chainWithPendingUpdates(this.notebookDocument, (edit) => {
            if (cell.index >= 0) {
                if (
                    !this.isDeleted &&
                    cell.kind === NotebookCellKind.Markup &&
                    cell.metadata.isInteractiveWindowMessageCell
                ) {
                    edit.replace(cell.document.uri, new Range(0, 0, cell.document.lineCount, 0), newMessage);
                    edit.set(this.notebookDocument!.uri, [
                        NotebookEdit.updateCellMetadata(cell.index, {
                            isInteractiveWindowMessageCell: true
                        })
                    ]);
                    return;
                }
            }
        });
    }

    public async deleteCell() {
        this.isDeleted = true;
        const cell = await this.sysInfoCellPromise;
        await chainWithPendingUpdates(this.notebookDocument, (edit) => {
            if (cell.index >= 0) {
                if (
                    cell.kind === NotebookCellKind.Markup &&
                    cell.metadata.isInteractiveWindowMessageCell &&
                    cell.metadata.isPlaceholder
                ) {
                    const nbEdit = NotebookEdit.deleteCells(new NotebookRange(cell.index, cell.index + 1));
                    edit.set(this.notebookDocument.uri, [nbEdit]);
                    return;
                }
            }
        });
    }
}
