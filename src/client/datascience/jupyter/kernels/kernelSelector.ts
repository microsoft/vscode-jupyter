// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import '../../../common/extensions';
import { Resource } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { Commands } from '../../constants';
import { IInteractiveWindowProvider } from '../../types';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { KernelConnectionMetadata } from './types';
import { getActiveInteractiveWindow } from '../../interactive-window/helpers';
import { IServiceContainer } from '../../../ioc/types';
import { getResourceType } from '../../common';
import { traceError } from '../../../common/logger';

/**
 * All KernelConnections returned (as return values of methods) by the KernelSelector can be used in a number of ways.
 * E.g. some part of the code update the `interpreter` property in the `KernelConnectionMetadata` object.
 * We need to ensure such changes (i.e. updates to the `KernelConnectionMetadata`) downstream do not change the original `KernelConnectionMetadata`.
 * Hence always clone the `KernelConnectionMetadata` returned by the `kernelSelector`.
 */
@injectable()
export class KernelSelector {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IServiceContainer) protected serviceContainer: IServiceContainer // @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider
    ) {}

    public async askForLocalKernel(resource: Resource, kernelConnection?: KernelConnectionMetadata): Promise<void> {
        const displayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
        const message = localize.DataScience.sessionStartFailedWithKernel().format(
            displayName,
            Commands.ViewJupyterOutput
        );
        const selectKernelLabel = localize.DataScience.selectDifferentKernel();
        const cancel = localize.Common.cancel();
        const selection = await this.applicationShell.showErrorMessage(message, selectKernelLabel, cancel);
        if (selection === selectKernelLabel) {
            await selectKernel(
                resource,
                this.notebooks,
                this.serviceContainer.get(IInteractiveWindowProvider),
                this.commandManager
            );
        }
    }
}

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
            ? interactiveWindowProvider.activeWindow?.notebookEditor
            : undefined;

    const notebookEditor = targetNotebookEditor || targetInteractiveNotebookEditor || activeInteractiveNotebookEditor;
    if (notebookEditor) {
        return commandManager.executeCommand('notebook.selectKernel', {
            notebookEditor
        });
    }
    traceError(`Unable to select kernel as the Notebook document could not be identified`);
}
