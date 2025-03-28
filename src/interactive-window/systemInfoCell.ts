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
import { InteractiveWindow } from './interactiveWindow';

export function getStartConnectMessage(kernelMetadata: KernelConnectionMetadata, reason: SysInfoReason) {
    const displayName = getDisplayNameOrNameOfKernelConnection(kernelMetadata);
    if (displayName) {
        return reason == SysInfoReason.Restart
            ? DataScience.restartingKernelCustomHeader(displayName)
            : DataScience.startingNewKernelCustomHeader(displayName);
    } else {
        return reason == SysInfoReason.Restart
            ? DataScience.restartingKernelHeader
            : DataScience.startingNewKernelHeader;
    }
}

export function getFinishConnectMessage(kernelMetadata: KernelConnectionMetadata, reason: SysInfoReason) {
    const displayName = getDisplayNameOrNameOfKernelConnection(kernelMetadata);
    return reason == SysInfoReason.Restart
        ? DataScience.restartedKernelHeader(displayName || '')
        : DataScience.connectedKernelHeader(displayName || '');
}

export function isSysInfoCell(cell: NotebookCell) {
    return cell.kind === NotebookCellKind.Markup && cell.metadata?.isInteractiveWindowMessageCell === true;
}

export class SystemInfoCell {
    private sysInfoCellPromise: Promise<NotebookCell>;
    private isDeleted = false;

    constructor(
        private readonly interactiveWindow: InteractiveWindow,
        private readonly notebookDocument: NotebookDocument,
        message: string
    ) {
        this.sysInfoCellPromise = this.getOrUpdate(message);
    }

    public async resolveCell() {
        return await this.sysInfoCellPromise;
    }

    private async getOrUpdate(message: string) {
        const lastCellIndex = (await this.interactiveWindow.getAppendIndex()) - 1;
        if (lastCellIndex >= 0) {
            const lastCell = this.notebookDocument.cellAt(lastCellIndex);
            if (isSysInfoCell(lastCell)) {
                return this.updateMessage(message);
            }
        }

        return (this.sysInfoCellPromise = this.createCell(message));
    }

    private async createCell(message: string) {
        let addedCellIndex: number | undefined;
        await chainWithPendingUpdates(this.notebookDocument, async (edit) => {
            const markdownCell = new NotebookCellData(NotebookCellKind.Markup, message, MARKDOWN_LANGUAGE);
            markdownCell.metadata = { isInteractiveWindowMessageCell: true };
            addedCellIndex = await this.interactiveWindow.getAppendIndex();
            const nbEdit = NotebookEdit.insertCells(addedCellIndex, [markdownCell]);
            edit.set(this.notebookDocument.uri, [nbEdit]);
        });
        return this.notebookDocument.cellAt(addedCellIndex!);
    }

    public async updateMessage(newMessage: string) {
        const cell = await this.sysInfoCellPromise;
        await chainWithPendingUpdates(this.notebookDocument, (edit) => {
            if (cell.index >= 0) {
                if (!this.isDeleted && isSysInfoCell(cell)) {
                    edit.replace(cell.document.uri, new Range(0, 0, cell.document.lineCount, 0), newMessage);

                    edit.set(this.notebookDocument!.uri, [
                        NotebookEdit.updateCellMetadata(cell.index, { isInteractiveWindowMessageCell: true })
                    ]);
                    return;
                }
            }
        });
        return cell;
    }

    public async deleteCell() {
        this.isDeleted = true;
        const cell = await this.sysInfoCellPromise;
        await chainWithPendingUpdates(this.notebookDocument, (edit) => {
            if (cell.index >= 0) {
                if (isSysInfoCell(cell)) {
                    const nbEdit = NotebookEdit.deleteCells(new NotebookRange(cell.index, cell.index + 1));
                    edit.set(this.notebookDocument.uri, [nbEdit]);
                    return;
                }
            }
        });
    }
}
