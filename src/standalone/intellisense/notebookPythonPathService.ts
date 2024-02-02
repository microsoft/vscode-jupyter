// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, workspace } from 'vscode';

export function getNotebookUriFromInputBoxUri(textDocumentUri: Uri): Uri | undefined {
    if (textDocumentUri.scheme !== 'vscode-interactive-input') {
        return undefined;
    }

    const notebookPath = `${textDocumentUri.path.replace('InteractiveInput-', 'Interactive-')}.interactive`;
    return workspace.notebookDocuments.find((doc) => doc.uri.path === notebookPath)?.uri;
}
