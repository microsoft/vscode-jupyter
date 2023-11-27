// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { notebooks } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { traceInfo } from '../platform/logging';
import { IKernelFinder } from './types';
/**
 * Ensures we refresh the list of Python environments upon opening a Notebook.
 */
@injectable()
export class KernelRefreshIndicator implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    private refreshedOnceBefore?: boolean;
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder
    ) {
        disposables.push(this);
    }
    public dispose() {
        dispose(this.disposables);
    }
    public activate() {
        this.startRefresh();
    }

    private startRefresh() {
        if (this.refreshedOnceBefore) {
            return;
        }
        if (this.kernelFinder.status === 'discovering') {
            return this.displayProgressIndicator();
        }

        // Its possible the refresh of kernels has not started,
        // hence the first time we get a non idle status, display the progress indicator.
        // We only do this for the first refresh.
        // Other times the refresh will most likely take place as a result of user hitting refresh button in kernel picker,
        // & at that time we display the progress indicator in the quick pick.
        this.kernelFinder.onDidChangeStatus(
            () => {
                if (this.kernelFinder.status === 'discovering') {
                    this.displayProgressIndicator();
                }
            },
            this,
            this.disposables
        );
    }
    private displayProgressIndicator() {
        const id = Date.now().toString();
        traceInfo(`Start refreshing Kernel Picker (${id})`);
        const taskNb = notebooks.createNotebookControllerDetectionTask(JupyterNotebookView);
        const taskIW = notebooks.createNotebookControllerDetectionTask(InteractiveWindowView);
        this.disposables.push(taskNb);
        this.disposables.push(taskIW);

        this.kernelFinder.onDidChangeStatus(
            () => {
                if (this.kernelFinder.status === 'idle') {
                    traceInfo(`End refreshing Kernel Picker (${id})`);
                    taskNb.dispose();
                    taskIW.dispose();
                }
            },
            this,
            this.disposables
        );
    }
}
