// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import { Memento, NotebookDocument, Uri } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { IDisposableRegistry, IMemento, WORKSPACE_MEMENTO } from '../../common/types';
import { switchKernel } from '../jupyter/kernels/kernelSelector';
import { IKernelProvider, LiveKernelConnectionMetadata } from '../jupyter/kernels/types';
import { INotebookControllerManager } from './types';

const MEMENTO_BASE_KEY = 'jupyter-notebook-remote-session-';

/**
 * This class listens tracks notebook controller selection. When a notebook runs
 * a remote kernel, it remembers the live kernel session id so that the next time the notebook opens,
 * it will force that live kernel as the selected controller.
 */
@injectable()
export class LiveKernelSwitcher implements IExtensionSingleActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(INotebookControllerManager) private readonly controllerManager: INotebookControllerManager,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private readonly memento: Memento,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {}
    public async activate(): Promise<void> {
        // Listen to remove refresh events. We need to see when we get a remote kernel
        this.controllerManager.remoteRefreshed(this.onLiveRefresh, this, this.disposables);

        // Listen to notebook open events. If we open a notebook that had a remote kernel started on it, reset it
        this.vscNotebook.onDidOpenNotebookDocument(this.onDidOpenNotebook, this, this.disposables);
    }

    private getKey(notebookUri: Uri) {
        return `${MEMENTO_BASE_KEY}${notebookUri.fsPath}`;
    }

    private onDidOpenNotebook(n: NotebookDocument) {
        const key = this.getKey(n.uri);
        const session = this.memento.get(key);
        if (session) {
            // When all controllers are loaded, see if one matches
            this.controllerManager.kernelConnections
                .then(async (list) => {
                    const active = this.controllerManager.getSelectedNotebookController(n);
                    const matching = list.find((l) => l.id === session);
                    if (matching && active?.id !== matching.id) {
                        // This controller is the one we want, but it's not currently set.
                        await switchKernel(n.uri, this.vscNotebook, undefined, this.commandManager, matching);
                    } else {
                        // There's no match, so live connection must be gone
                        await this.memento.update(key, undefined);
                    }
                })
                .catch((e) => traceError(e));
        }
    }

    private onLiveRefresh(liveConnections: LiveKernelConnectionMetadata[]) {
        // When a refresh happens, remember the live connection id for all notebooks
        this.vscNotebook.notebookDocuments.forEach(async (n) => {
            const kernel = this.kernelProvider.get(n);
            if (kernel) {
                const match = liveConnections.find((c) => c.kernelModel.id === kernel.session?.kernelId);
                if (match) {
                    const key = this.getKey(n.uri);
                    await this.memento.update(key, match.id);
                }
            }
        });
    }
}
