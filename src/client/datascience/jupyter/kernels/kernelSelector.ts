// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import '../../../common/extensions';
import { Resource } from '../../../common/types';
import { IInteractiveWindowProvider } from '../../types';
import { getActiveInteractiveWindow } from '../../interactive-window/helpers';
import { getResourceType } from '../../common';
import { traceError } from '../../../common/logger';

export async function selectKernel(
    resource: Resource,
    notebooks: IVSCodeNotebook,
    interactiveWindowProvider: IInteractiveWindowProvider,
    commandManager: ICommandManager
) {
    const notebook =
        getResourceType(resource) === 'notebook'
            ? notebooks.notebookDocuments.find((item) => item.uri.toString() === resource?.toString())
            : undefined;
    const targetNotebookEditor =
        notebook && notebooks.activeNotebookEditor?.document === notebook ? notebooks.activeNotebookEditor : undefined;
    const targetInteractiveNotebookEditor =
        resource && getResourceType(resource) === 'interactive'
            ? interactiveWindowProvider.get(resource)?.notebookEditor
            : undefined;
    const activeInteractiveNotebookEditor =
        getResourceType(resource) === 'interactive'
            ? getActiveInteractiveWindow(interactiveWindowProvider)?.notebookEditor
            : undefined;

    const notebookEditor = targetNotebookEditor || targetInteractiveNotebookEditor || activeInteractiveNotebookEditor;
    if (notebookEditor) {
        return commandManager.executeCommand('notebook.selectKernel', {
            notebookEditor
        });
    }
    traceError(`Unable to select kernel as the Notebook document could not be identified`);
}
