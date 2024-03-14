// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, workspace } from 'vscode';

export function isUsingPylance() {
    const pythonConfig = workspace.getConfiguration('python');
    const languageServer = pythonConfig?.get<string>('languageServer');

    // Only enable the experiment if we're in the treatment group and the installed
    // versions of Python and Pylance support the experiment.

    if (languageServer !== 'Pylance' && languageServer !== 'Default') {
        return false;
    } else {
        return true;
    }
}

export function getNotebookUriFromInputBoxUri(textDocumentUri: Uri): Uri | undefined {
    if (textDocumentUri.scheme !== 'vscode-interactive-input') {
        return undefined;
    }

    const notebookPath = `${textDocumentUri.path.replace('InteractiveInput-', 'Interactive-')}.interactive`;
    return workspace.notebookDocuments.find((doc) => doc.uri.path === notebookPath)?.uri;
}
