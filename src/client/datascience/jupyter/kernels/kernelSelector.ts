// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import '../../../common/extensions';
import { Resource } from '../../../common/types';
import { IInteractiveWindowProvider } from '../../types';
import { getActiveInteractiveWindow } from '../../interactive-window/helpers';
import { getResourceType } from '../../common';
import { traceError } from '../../../common/logger';
import { KernelConnectionMetadata } from './types';
import { JVSC_EXTENSION_ID } from '../../../common/constants';

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
