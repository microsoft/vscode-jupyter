// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { IApplicationShell, ICommandManager } from '../../../common/application/types';
import '../../../common/extensions';
import { Resource } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { Commands } from '../../constants';
import { IInteractiveWindowProvider } from '../../types';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { KernelConnectionMetadata } from './types';
import { getActiveInteractiveWindow } from '../../interactive-window/helpers';
import { IServiceContainer } from '../../../ioc/types';
import { noop } from '../../../common/utils/misc';

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
        @inject(IServiceContainer) protected serviceContainer: IServiceContainer // @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider
    ) { }

    public async askForLocalKernel(
        _resource: Resource,
        kernelConnection?: KernelConnectionMetadata
    ): Promise<void> {
        const displayName = getDisplayNameOrNameOfKernelConnection(kernelConnection);
        const message = localize.DataScience.sessionStartFailedWithKernel().format(
            displayName,
            Commands.ViewJupyterOutput
        );
        const selectKernel = localize.DataScience.selectDifferentKernel();
        const cancel = localize.Common.cancel();
        const selection = await this.applicationShell.showErrorMessage(message, selectKernel, cancel);
        if (selection === selectKernel) {
            const targetNotebookEditor = getActiveInteractiveWindow(
                this.serviceContainer.get(IInteractiveWindowProvider)
            )?.notebookEditor;
            if (targetNotebookEditor) {
                this.commandManager
                    .executeCommand('notebook.selectKernel', { notebookEditor: targetNotebookEditor })
                    .then(noop, noop);
            } else {
                this.commandManager.executeCommand('notebook.selectKernel').then(noop, noop);
            }
        }
    }
}
