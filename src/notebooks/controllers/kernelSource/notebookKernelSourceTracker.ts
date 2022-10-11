// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookControllerAffinity2, NotebookDocument, workspace } from 'vscode';
import { IContributedKernelFinderInfo } from '../../../kernels/internalTypes';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { IControllerRegistration, INotebookKernelSourceTracker, IVSCodeNotebookController } from '../types';

// Tracks what kernel source is assigned to which document, also will persist that data
@injectable()
export class NotebookKernelSourceTracker implements INotebookKernelSourceTracker, IExtensionSyncActivationService {
    // IANHU: Maybe go back to weak map here?
    private documentSourceMapping: Map<NotebookDocument, IContributedKernelFinderInfo | undefined> = new Map<
        NotebookDocument,
        IContributedKernelFinderInfo
    >();

    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration
    ) {}

    activate(): void {
        workspace.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposableRegistry);
        workspace.onDidCloseNotebookDocument(this.onDidCloseNotebookDocument, this, this.disposableRegistry);
        this.controllerRegistration.onCreated(this.onCreatedController, this, this.disposableRegistry);

        // Tag all open documents
        workspace.notebookDocuments.forEach(this.onDidOpenNotebookDocument.bind(this));
    }

    public getKernelSourceForNotebook(notebook: NotebookDocument): IContributedKernelFinderInfo | undefined {
        return this.documentSourceMapping.get(notebook);
    }
    public setKernelSourceForNotebook(notebook: NotebookDocument, kernelSource: IContributedKernelFinderInfo): void {
        this.documentSourceMapping.set(notebook, kernelSource);

        // After setting the kernelsource we now need to change the affinity of the controllers to hide all controllers not from that finder
        this.updateControllerAffinity(notebook, kernelSource);
    }

    private onCreatedController(controller: IVSCodeNotebookController) {
        this.documentSourceMapping.forEach((finderInfo, notebook) => {
            if (
                controller.connection.kernelFinderInfo &&
                finderInfo &&
                controller.connection.kernelFinderInfo.id === finderInfo.id
            ) {
                // Match, associate with controller
                this.associateController(notebook, controller);
            } else {
                this.disassociateController(notebook, controller);
            }
        });
    }

    private updateControllerAffinity(notebook: NotebookDocument, kernelSource: IContributedKernelFinderInfo) {
        const nonAssociatedControllers = this.controllerRegistration.registered.filter((controller) => {
            if (
                !controller.connection.kernelFinderInfo ||
                controller.connection.kernelFinderInfo.id !== kernelSource.id
            ) {
                return true;
            }
            return false;
        });

        const associatedControllers = this.controllerRegistration.registered.filter((controller) => {
            if (
                !controller.connection.kernelFinderInfo ||
                controller.connection.kernelFinderInfo.id !== kernelSource.id
            ) {
                return false;
            }
            return true;
        });

        // IANHU: Bug here. First off, the above reversal is ugly. Second when reassociating everything is set to default
        // at this point we should do a new suggested check to see our best suggestion from what is available

        nonAssociatedControllers.forEach((controller) => {
            this.disassociateController(notebook, controller);
        });

        associatedControllers.forEach((controller) => {
            this.associateController(notebook, controller);
        });
    }

    private associateController(notebook: NotebookDocument, controller: IVSCodeNotebookController) {
        controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Default);
    }

    private disassociateController(notebook: NotebookDocument, controller: IVSCodeNotebookController) {
        controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Hidden);
    }

    private onDidOpenNotebookDocument(notebook: NotebookDocument) {
        this.documentSourceMapping.set(notebook, undefined);
        // IANHU: Default thing to use here? We should persist this, but for now when it's opened
        // just disassociate from everything, then we can add them in as we select kernel sources
        this.controllerRegistration.registered.forEach((controller) => {
            this.disassociateController(notebook, controller);
        });
    }

    private onDidCloseNotebookDocument(notebook: NotebookDocument) {
        // IANHU: Also need to reassociate here?
        this.documentSourceMapping.delete(notebook);
    }
}
