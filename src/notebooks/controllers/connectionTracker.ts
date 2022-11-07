// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookControllerAffinity2, NotebookDocument, workspace } from 'vscode';
import { KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';
import { IDisposableRegistry } from '../../platform/common/types';
import { getNotebookMetadata, isJupyterNotebook } from '../../platform/common/utils';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import {
    IControllerRegistration,
    IKernelRankingHelper,
    IConnectionMru,
    IConnectionTracker,
    IVSCodeNotebookController
} from './types';

@injectable()
export class ConnectionTracker implements IExtensionSyncActivationService, IConnectionTracker {
    private documentSourceMapping = new WeakMap<NotebookDocument, Set<KernelConnectionMetadata>>();

    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IKernelRankingHelper) private readonly kernelRankingHelper: IKernelRankingHelper,
        @inject(IConnectionMru) private readonly notebookConnectionMru: IConnectionMru
    ) {}

    activate(): void {
        workspace.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposableRegistry);
        this.controllerRegistration.onCreated(this.onCreatedController, this, this.disposableRegistry);

        // Tag all open documents
        workspace.notebookDocuments.forEach(this.onDidOpenNotebookDocument.bind(this));
    }

    public async trackSelection(notebook: NotebookDocument, connection: KernelConnectionMetadata): Promise<void> {
        const connections = this.documentSourceMapping.get(notebook) || new Set<KernelConnectionMetadata>();
        connections.add(connection);
        this.documentSourceMapping.set(notebook, connections);

        const controller = this.controllerRegistration.get(
            connection,
            notebook.notebookType as typeof JupyterNotebookView | typeof InteractiveWindowView
        );
        if (controller) {
            // Ensure this controller is visible for this document.
            controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Default);
        }
        await this.notebookConnectionMru.add(notebook, connection);
    }

    /**
     * I.e. assume we used Kernel A with a notebook.
     * Next time we open this notebook in a different vscode session, we
     * need to ensure this connection is visible for this notebook and others (that weren't used) are hidden.
     *
     * & if this matches exactly with the last used kernel connection, then mark it as preferred.
     */
    @swallowExceptions()
    private async onDidOpenNotebookDocument(notebook: NotebookDocument) {
        if (!this.documentSourceMapping.has(notebook) && isJupyterNotebook(notebook)) {
            await Promise.all(
                this.controllerRegistration.registered.map((controller) =>
                    this.updateAffinity(notebook, controller.connection)
                )
            );
        }
    }

    /**
     * I.e. assume we used Kernel A with a notebook.
     * Next time we open this notebook in a different vscode session and then create this controller, we
     * need to ensure this connection is visible for this notebook, else if this wasn't used then hide it.
     *
     * & if this matches exactly with the last used kernel connection, then mark it as preferred.
     */
    @swallowExceptions()
    private async onCreatedController(controller: IVSCodeNotebookController) {
        await Promise.all(
            workspace.notebookDocuments.map(async (notebook) => {
                await this.updateAffinity(notebook, controller.connection);
            })
        );
    }
    private async updateAffinity(notebook: NotebookDocument, connection: KernelConnectionMetadata) {
        const controller = this.controllerRegistration.get(
            connection,
            notebook.notebookType as typeof JupyterNotebookView | typeof InteractiveWindowView
        );
        if (!controller) {
            return;
        }
        const usedInThisSession = Array.from(
            this.documentSourceMapping.get(notebook) || new Set<KernelConnectionMetadata>()
        ).find((item) => item.id === connection.id);
        const [exactMatch, usedPreviously] = await Promise.all([
            this.kernelRankingHelper.isExactMatch(notebook.uri, controller.connection, getNotebookMetadata(notebook)),
            usedInThisSession
                ? Promise.resolve(usedInThisSession)
                : this.notebookConnectionMru.exists(notebook, controller.connection)
        ]);

        if (!exactMatch && !usedPreviously) {
            controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Hidden);
            return;
        }
        if (exactMatch) {
            controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Preferred);
        } else {
            controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Default);
        }
    }
}
