// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookDocument, window } from 'vscode';
import { InteractiveWindowView } from '../common/constants';


export function IsForVisibleReplEditor(notebook: NotebookDocument): boolean {
    if (notebook.notebookType === InteractiveWindowView) {
        return true;
    }
    const editor = window.visibleNotebookEditors.find((e) => e.notebook === notebook);
    return !!editor?.replOptions;
}
