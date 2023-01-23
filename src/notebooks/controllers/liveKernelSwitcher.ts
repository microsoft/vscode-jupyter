// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IVSCodeNotebook, ICommandManager } from '../../platform/common/application/types';
import { traceInfo, traceVerbose } from '../../platform/logging';
import { IDisposableRegistry } from '../../platform/common/types';
import { PreferredRemoteKernelIdProvider } from '../../kernels/jupyter/preferredRemoteKernelIdProvider';
import { KernelConnectionMetadata } from '../../kernels/types';
import { JVSC_EXTENSION_ID } from '../../platform/common/constants';
import { waitForCondition } from '../../platform/common/utils/async';
import { IControllerRegistration } from './types';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import { isJupyterNotebook } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';

/**
 * This class listens tracks notebook controller selection. When a notebook runs
 * a remote kernel, it remembers the live kernel session id so that the next time the notebook opens,
 * it will force that live kernel as the selected controller.
 */
@injectable()
export class LiveKernelSwitcher implements IExtensionSyncActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(PreferredRemoteKernelIdProvider)
        private readonly preferredRemoteKernelIdProvider: PreferredRemoteKernelIdProvider
    ) {}
    public activate() {
        // Listen to notebook open events. If we open a notebook that had a remote kernel started on it, reset it
        this.vscNotebook.onDidOpenNotebookDocument(this.onDidOpenNotebook, this, this.disposables);

        // For all currently open notebooks, need to run the same code
        this.vscNotebook.notebookDocuments.forEach((d) => this.onDidOpenNotebook(d));
    }

    @swallowExceptions()
    private async onDidOpenNotebook(notebook: NotebookDocument) {
        if (!isJupyterNotebook(notebook)) {
            return;
        }
        const preferredRemote = await this.preferredRemoteKernelIdProvider.getPreferredRemoteKernelId(notebook.uri);
        if (!preferredRemote) {
            return;
        }
        const findAndSelectRemoteController = () => {
            const active = this.controllerRegistration.getSelected(notebook);
            const matching = this.controllerRegistration.registered.find((l) => l.id === preferredRemote);
            if (matching && active?.id !== matching.id) {
                // This controller is the one we want, but it's not currently set.
                this.switchKernel(notebook, matching.connection).catch(noop);
                return true;
            }
            return false;
        };
        if (findAndSelectRemoteController()) {
            return;
        }

        const disposable = this.controllerRegistration.onDidChange(
            (e) => {
                if (!e.added.length) {
                    return;
                }

                if (findAndSelectRemoteController()) {
                    disposable.dispose();
                }
            },
            this,
            this.disposables
        );
        this.controllerRegistration.onControllerSelected(
            (e) => {
                if (e.notebook === notebook) {
                    // controller selected, stop attempting to change this our selves.
                    disposable.dispose();
                }
            },
            this,
            this.disposables
        );
    }

    private async switchKernel(n: NotebookDocument, kernel: Readonly<KernelConnectionMetadata>) {
        traceVerbose(`Using notebook.selectKernel to force remote kernel for ${n.uri} to ${kernel.id}`);
        // Do this in a loop as it may fail
        const success = await waitForCondition(
            async () => {
                if (this.vscNotebook.activeNotebookEditor?.notebook === n) {
                    await this.commandManager.executeCommand('notebook.selectKernel', {
                        id: kernel.id,
                        extension: JVSC_EXTENSION_ID
                    });
                    const selected = this.controllerRegistration.getSelected(n);
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
