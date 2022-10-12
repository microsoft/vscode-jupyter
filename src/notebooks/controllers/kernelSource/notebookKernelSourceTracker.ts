// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookControllerAffinity2, NotebookDocument, workspace } from 'vscode';
import { IContributedKernelFinderInfo } from '../../../kernels/internalTypes';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IDisposableRegistry } from '../../../platform/common/types';
import { IControllerRegistration, INotebookKernelSourceTracker, IVSCodeNotebookController } from '../types';

// Controls which kernel source is associated with each document, and controls hiding and showing kernel sources for them.
@injectable()
export class NotebookKernelSourceTracker implements INotebookKernelSourceTracker, IExtensionSyncActivationService {
    private documentSourceMapping: Map<NotebookDocument, IContributedKernelFinderInfo | undefined> = new Map<
        NotebookDocument,
        IContributedKernelFinderInfo | undefined
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

    // When a controller is created, see if it shows or hides for all open documents
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
        // Find the controller associated with the given kernel source
        const nonAssociatedControllers = this.controllerRegistration.registered.filter(
            (controller) => !this.controllerMatchesKernelSource(controller, kernelSource)
        );
        const associatedControllers = this.controllerRegistration.registered.filter((controller) =>
            this.controllerMatchesKernelSource(controller, kernelSource)
        );

        // At this point we need to pipe in our suggestion engine, right now everything will end up with default priority

        // Change the visibility on our controllers for that document
        nonAssociatedControllers.forEach((controller) => {
            this.disassociateController(notebook, controller);
        });
        associatedControllers.forEach((controller) => {
            this.associateController(notebook, controller);
        });
    }

    // Matching function to filter if controllers match a specific source
    private controllerMatchesKernelSource(
        controller: IVSCodeNotebookController,
        kernelSource: IContributedKernelFinderInfo
    ): boolean {
        if (controller.connection.kernelFinderInfo && controller.connection.kernelFinderInfo.id === kernelSource.id) {
            return true;
        }
        return false;
    }

    private associateController(notebook: NotebookDocument, controller: IVSCodeNotebookController) {
        controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Default);
    }

    private disassociateController(notebook: NotebookDocument, controller: IVSCodeNotebookController) {
        controller.controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Hidden);
    }

    private onDidOpenNotebookDocument(notebook: NotebookDocument) {
        this.documentSourceMapping.set(notebook, undefined);

        // We need persistance here moving forward, but for now, we just default to a fresh state of
        // not having a kernel source selected when we first open a document.
        this.controllerRegistration.registered.forEach((controller) => {
            this.disassociateController(notebook, controller);
        });
    }

    private onDidCloseNotebookDocument(notebook: NotebookDocument) {
        // Associate controller back to default on close
        this.controllerRegistration.registered.forEach((controller) => {
            this.associateController(notebook, controller);
        });

        this.documentSourceMapping.delete(notebook);
    }
}
