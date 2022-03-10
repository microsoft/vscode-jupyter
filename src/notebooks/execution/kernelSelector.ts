// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IVSCodeNotebook, ICommandManager } from '../../client/common/application/types';
import { JVSC_EXTENSION_ID } from '../../client/common/constants';
import { traceError } from '../../client/common/logger';
import { Resource } from '../../client/common/types';
import { getResourceType } from '../../client/datascience/common';
import { getActiveInteractiveWindow } from '../../client/datascience/interactive-window/helpers';
import { IInteractiveWindowProvider } from '../../client/datascience/types';
import { KernelConnectionMetadata } from '../types';

// TODO: This should probably move to a 'notebook' subsection

/**
 * Return `true` if a new kernel has been selected.
 */
export async function selectKernel(
    resource: Resource,
    notebooks: IVSCodeNotebook,
    interactiveWindowProvider: IInteractiveWindowProvider | undefined,
    commandManager: ICommandManager
): Promise<boolean> {
    const notebookEditor = findNotebookEditor(resource, notebooks, interactiveWindowProvider);
    if (notebookEditor) {
        return commandManager.executeCommand('notebook.selectKernel', {
            notebookEditor
        }) as Promise<boolean>;
    }
    traceError(`Unable to select kernel as the Notebook document could not be identified`);
    return false;
}

export async function switchKernel(
    resource: Resource,
    notebooks: IVSCodeNotebook,
    interactiveWindowProvider: IInteractiveWindowProvider | undefined,
    commandManager: ICommandManager,
    kernelMetadata: KernelConnectionMetadata
) {
    const notebookEditor = findNotebookEditor(resource, notebooks, interactiveWindowProvider);
    if (notebookEditor) {
        return commandManager.executeCommand('notebook.selectKernel', {
            id: kernelMetadata.id,
            extension: JVSC_EXTENSION_ID
        });
    }
    traceError(`Unable to select kernel as the Notebook document could not be identified`);
}

function findNotebookEditor(
    resource: Resource,
    notebooks: IVSCodeNotebook,
    interactiveWindowProvider: IInteractiveWindowProvider | undefined
) {
    const notebook =
        getResourceType(resource) === 'notebook'
            ? notebooks.notebookDocuments.find((item) => item.uri.toString() === resource?.toString())
            : undefined;
    const targetNotebookEditor =
        notebook && notebooks.activeNotebookEditor?.document === notebook ? notebooks.activeNotebookEditor : undefined;
    const targetInteractiveNotebookEditor =
        resource && getResourceType(resource) === 'interactive'
            ? interactiveWindowProvider?.get(resource)?.notebookEditor
            : undefined;
    const activeInteractiveNotebookEditor =
        getResourceType(resource) === 'interactive' && interactiveWindowProvider
            ? getActiveInteractiveWindow(interactiveWindowProvider)?.notebookEditor
            : undefined;

    return targetNotebookEditor || targetInteractiveNotebookEditor || activeInteractiveNotebookEditor;
}
