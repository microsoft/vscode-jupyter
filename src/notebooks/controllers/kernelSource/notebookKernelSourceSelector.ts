// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument, QuickPickItem } from 'vscode';
import { IContributedKernelFinderInfo } from '../../../kernels/internalTypes';
import { IKernelFinder } from '../../../kernels/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { INotebookKernelSourceSelector, INotebookKernelSourceTracker } from '../types';

interface KernelFinderQuickPickItem extends QuickPickItem {
    kernelFinderInfo: IContributedKernelFinderInfo;
}

@injectable()
export class NotebookKernelSourceSelector implements INotebookKernelSourceSelector {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(INotebookKernelSourceTracker) private readonly kernelSourceTracker: INotebookKernelSourceTracker,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder
    ) {}

    public async selectKernelSource(notebook: NotebookDocument): Promise<void> {
        const quickPickItems = this.kernelFinder.getRegisteredKernelFinderInfos().map(this.toQuickPickItem);
        const selectedItem = await this.applicationShell.showQuickPick(quickPickItems);

        // If we selected something persist that value
        if (selectedItem) {
            this.kernelSourceTracker.setKernelSourceForNotebook(notebook, selectedItem.kernelFinderInfo);
        }
    }

    toQuickPickItem(kernelFinderInfo: IContributedKernelFinderInfo): KernelFinderQuickPickItem {
        return { kernelFinderInfo, label: kernelFinderInfo.displayName };
    }
}
