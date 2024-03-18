// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCellKind, type NotebookCell, type NotebookCellData } from 'vscode';
import type * as nbformat from '@jupyterlab/nbformat';

type JupyterCellMetadata = Pick<nbformat.IRawCell, 'id' | 'metadata' | 'attachments'> &
    Pick<nbformat.IMarkdownCell, 'id' | 'attachments'> &
    Pick<nbformat.ICodeCell, 'id' | 'metadata' | 'attachments'> &
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Record<string, any>;

export function getCellMetadata(cell: NotebookCell | NotebookCellData): JupyterCellMetadata {
    const metadata: JupyterCellMetadata = cell.metadata?.custom || {};
    if (cell.kind !== NotebookCellKind.Markup) {
        const cellMetadata = metadata as nbformat.IRawCell;
        // metadata property is never optional.
        cellMetadata.metadata = cellMetadata.metadata || {};
    }

    return metadata;
}
