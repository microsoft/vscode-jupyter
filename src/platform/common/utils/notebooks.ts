// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, window, workspace } from 'vscode';

export async function openAndShowNotebook(file: Uri) {
    const nb = await workspace.openNotebookDocument(file);
    await window.showNotebookDocument(nb);
}
