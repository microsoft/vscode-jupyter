// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { notebooks } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { JupyterNotebookView } from '../platform/common/constants';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
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
        disposeAllDisposables(this.disposables);
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
        const task = notebooks.createNotebookControllerDetectionTask(JupyterNotebookView);
        this.disposables.push(task);

        this.kernelFinder.onDidChangeStatus(
            () => {
                if (this.kernelFinder.status === 'idle') {
                    return task.dispose();
                }
            },
            this,
            this.disposables
        );
    }
}
