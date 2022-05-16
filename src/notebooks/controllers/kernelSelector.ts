// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IVSCodeNotebook, ICommandManager } from '../../platform/common/application/types';
import { JVSC_EXTENSION_ID } from '../../platform/common/constants';
import { traceError } from '../../platform/logging';
import { Resource } from '../../platform/common/types';
import { getActiveInteractiveWindow } from '../../interactive-window/helpers';
import { IKernel, KernelConnectionMetadata } from '../../kernels/types';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { getResourceType } from '../../platform/common/utils';
import { workspace } from 'vscode';
import { getComparisonKey } from '../../platform/vscode-path/resources';

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
    traceError(`Unable to select kernel as the Notebook document for ${resource} could not be identified`);
}

export function findNotebookEditor(
    resource: Resource,
    notebooks: IVSCodeNotebook,
    interactiveWindowProvider: IInteractiveWindowProvider | undefined
) {
    const key = resource ? getComparisonKey(resource, true) : 'false';
    const notebook =
        getResourceType(resource) === 'notebook'
            ? notebooks.notebookDocuments.find((item) => getComparisonKey(item.uri, true) === key)
            : undefined;
    const targetNotebookEditor =
        notebook && notebooks.activeNotebookEditor?.notebook === notebook ? notebooks.activeNotebookEditor : undefined;
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

export function getAssociatedNotebookDocument(kernel: IKernel | undefined) {
    if (!kernel) {
        return;
    }

    return workspace.notebookDocuments.find((nb) => nb.uri.toString() === kernel.id.toString());
}
