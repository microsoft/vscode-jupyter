// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IVSCodeNotebook, ICommandManager } from '../../platform/common/application/types';
import { traceError, traceInfo } from '../../platform/logging';
import { IDisposableRegistry } from '../../platform/common/types';
import { INotebookControllerManager } from '../types';
import { PreferredRemoteKernelIdProvider } from '../../kernels/jupyter/preferredRemoteKernelIdProvider';
import { KernelConnectionMetadata } from '../../kernels/types';
import { JVSC_EXTENSION_ID } from '../../platform/common/constants';
import { waitForCondition } from '../../platform/common/utils/async';

/**
 * This class listens tracks notebook controller selection. When a notebook runs
 * a remote kernel, it remembers the live kernel session id so that the next time the notebook opens,
 * it will force that live kernel as the selected controller.
 */
@injectable()
export class LiveKernelSwitcher implements IExtensionSingleActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(INotebookControllerManager) private readonly controllerManager: INotebookControllerManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider
    ) {}
    public async activate(): Promise<void> {
        // Listen to notebook open events. If we open a notebook that had a remote kernel started on it, reset it
        this.vscNotebook.onDidOpenNotebookDocument(this.onDidOpenNotebook, this, this.disposables);

        // For all currently open notebooks, need to run the same code
        this.vscNotebook.notebookDocuments.forEach((d) => this.onDidOpenNotebook(d));
    }

    private onDidOpenNotebook(n: NotebookDocument) {
        // When all controllers are loaded, see if one matches
        this.controllerManager.kernelConnections
            .then(async (list) => {
                const active = this.controllerManager.getSelectedNotebookController(n);
                const preferredRemote = this.preferredRemoteKernelIdProvider.getPreferredRemoteKernelId(n.uri);
                const matching = preferredRemote && list.find((l) => l.id === preferredRemote);
                if (matching && active?.id !== matching.id) {
                    traceInfo(`Switching remote kernel to ${preferredRemote} for ${n.uri}`);
                    // This controller is the one we want, but it's not currently set.
                    await this.switchKernel(n, matching);
                }
            })
            .catch((e) => traceError(e));
    }

    private async switchKernel(n: NotebookDocument, kernel: Readonly<KernelConnectionMetadata>) {
        traceInfo(`Using notebook.selectKernel to force remote kernel for ${n.uri} to ${kernel.id}`);
        // Do this in a loop as it may fail
        const success = await waitForCondition(
            async () => {
                if (this.vscNotebook.activeNotebookEditor?.document === n) {
                    await this.commandManager.executeCommand('notebook.selectKernel', {
                        id: kernel.id,
                        extension: JVSC_EXTENSION_ID
                    });
                    const selected = this.controllerManager.getSelectedNotebookController(n);
                    return selected?.connection.id === kernel.id;
                }
                return false;
            },
            2000,
            100
        );
        traceInfo(`Results of switching remote kernel: ${success}`);
    }
}
