// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { traceError } from '../../platform/logging';
import { Resource } from '../../platform/common/types';
import { INotebookEditorProvider } from '../types';
import { commands } from 'vscode';

/**
 * Return `true` if a new kernel has been selected.
 */
export async function selectKernel(
    resource: Resource,
    notebookEditorProvider: INotebookEditorProvider | undefined
): Promise<boolean> {
    const notebookEditor = notebookEditorProvider?.findNotebookEditor(resource);
    if (notebookEditor) {
        return commands.executeCommand('notebook.selectKernel', {
            notebookEditor
        }) as Promise<boolean>;
    }
    traceError(`Unable to select kernel as the Notebook document could not be identified`);
    return false;
}
