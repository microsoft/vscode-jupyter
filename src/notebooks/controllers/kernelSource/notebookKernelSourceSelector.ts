// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument, QuickPickItem, QuickPickItemKind } from 'vscode';
import { IContributedKernelFinderInfo } from '../../../kernels/internalTypes';
import { IKernelFinder } from '../../../kernels/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { InteractiveWindowView, JupyterNotebookView, JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { DataScience } from '../../../platform/common/utils/localize';
import {
    IMultiStepInput,
    IMultiStepInputFactory,
    IQuickPickParameters
} from '../../../platform/common/utils/multiStepInput';
import { compareIgnoreCase, groupBy } from '../commands/serverConnectionControllerCommands';
import {
    IControllerRegistration,
    INotebookKernelSourceSelector,
    INotebookKernelSourceTracker,
    IVSCodeNotebookController
} from '../types';

interface KernelFinderQuickPickItem extends QuickPickItem {
    kernelFinderInfo: IContributedKernelFinderInfo;
}

interface ControllerQuickPickItem extends QuickPickItem {
    controller: IVSCodeNotebookController;
}

// The return type of our multistep selection process
type MultiStepResult = { source?: IContributedKernelFinderInfo; controller?: IVSCodeNotebookController };

// Provides the UI to select a Kernel Source for a given notebook document
@injectable()
export class NotebookKernelSourceSelector implements INotebookKernelSourceSelector {
    constructor(
        @inject(INotebookKernelSourceTracker) private readonly kernelSourceTracker: INotebookKernelSourceTracker,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder,
        @inject(IMultiStepInputFactory) private readonly multiStepFactory: IMultiStepInputFactory,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {}

    public async selectKernelSource(notebook: NotebookDocument): Promise<void> {
        // Reject if it's not our type
        if (notebook.notebookType !== JupyterNotebookView && notebook.notebookType !== InteractiveWindowView) {
            return;
        }

        const multiStep = this.multiStepFactory.create<MultiStepResult>();
        const state: MultiStepResult = {};
        await multiStep.run(this.getSource.bind(this, notebook.notebookType), state);

        // If we got both parts of the equation, then perform the kernel source and kernel switch
        if (state.source && state.controller) {
            await this.applyResults(notebook, state);
        }
    }

    // The first stage of the multistep to get source and kernel
    private async getSource(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        const quickPickItems = this.kernelFinder.registered.map(this.toQuickPickItem);
        const selectedSource = await multiStep.showQuickPick<
            KernelFinderQuickPickItem,
            IQuickPickParameters<KernelFinderQuickPickItem>
        >({ items: quickPickItems, placeholder: '', title: DataScience.kernelPickerSelectSourceTitle() });

        if (selectedSource) {
            // Got a source, now get the kernel
            state.source = selectedSource.kernelFinderInfo;
            return this.getKernel.bind(this, notebookType);
        }
    }

    // Second stage of the multistep to pick a kernel
    private async getKernel(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        multiStep: IMultiStepInput<MultiStepResult>,
        state: MultiStepResult
    ) {
        if (!state.source) {
            return;
        }

        const matchingControllers = this.getMatchingControllers(state.source, notebookType);

        // Create controller items and group the by category
        const controllerPickItems: ControllerQuickPickItem[] = matchingControllers.map((controller) => {
            return {
                label: controller.label,
                detail: undefined,
                description: controller.controller.description,
                controller
            };
        });

        const kernelsPerCategory = groupBy(controllerPickItems, (a, b) =>
            compareIgnoreCase(a.controller.controller.kind || 'z', b.controller.controller.kind || 'z')
        );

        // Insert separators into the right spots in the list
        const kindIndexes = new Map<string, number>();
        const quickPickItems: (QuickPickItem | ControllerQuickPickItem)[] = [];

        kernelsPerCategory.forEach((items) => {
            const kind = items[0].controller.controller.kind || 'Other';
            quickPickItems.push({
                kind: QuickPickItemKind.Separator,
                label: kind
            });
            quickPickItems.push(...items);
            kindIndexes.set(kind, quickPickItems.length);
        });

        const result = await multiStep.showQuickPick<
            ControllerQuickPickItem | QuickPickItem,
            IQuickPickParameters<ControllerQuickPickItem | QuickPickItem>
        >({
            title: DataScience.kernelPickerSelectKernelTitle(),
            items: quickPickItems,
            matchOnDescription: true,
            matchOnDetail: true,
            placeholder: ''
        });

        if ('controller' in result) {
            state.controller = result.controller;
        }
    }

    // Get all registered controllers that match a specific finder
    private getMatchingControllers(
        kernelSource: IContributedKernelFinderInfo,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): IVSCodeNotebookController[] {
        return this.controllerRegistration.registered.filter((controller) => {
            const finder = this.kernelFinder.getFinderForConnection(controller.connection);
            return finder?.id === kernelSource.id && controller.viewType === notebookType;
        });
    }

    // If we completed the multistep with results, apply those results
    private async applyResults(notebook: NotebookDocument, result: MultiStepResult) {
        // First apply the kernel filter to this document
        result.source && this.kernelSourceTracker.setKernelSourceForNotebook(notebook, result.source);

        // Then select the kernel that we wanted
        result.controller &&
            (await this.commandManager.executeCommand('notebook.selectKernel', {
                id: result.controller.id,
                extension: JVSC_EXTENSION_ID
            }));
    }

    // Convert a kernel finder info in a quick pick item
    toQuickPickItem(kernelFinderInfo: IContributedKernelFinderInfo): KernelFinderQuickPickItem {
        return { kernelFinderInfo, label: kernelFinderInfo.displayName };
    }
}
