// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCellKind, NotebookDocument } from 'vscode';
import { getLanguageInNotebookMetadata } from '../../kernels/helpers';
import { getNotebookMetadata } from '../../platform/common/utils';
import { traceWarning } from '../../platform/logging';

// Get the language of the notebook document, preference given to metadata over the language of
// the first cell
export function getLanguageOfNotebookDocument(doc: NotebookDocument): string | undefined {
    // If the document has been closed, accessing cell information can fail.
    // Ignore such exceptions.
    try {
        // Give preference to the language information in the metadata.
        const language = getLanguageInNotebookMetadata(getNotebookMetadata(doc));
        // Fall back to the language of the first code cell in the notebook.
        return language || doc.getCells().find((cell) => cell.kind === NotebookCellKind.Code)?.document.languageId;
    } catch (ex) {
        traceWarning('Failed to determine language of first cell', ex);
    }
}
