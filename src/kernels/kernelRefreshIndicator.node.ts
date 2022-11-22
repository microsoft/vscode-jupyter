// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { notebooks } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { IKernelFinder } from './types';

/**
 * Ensures we refresh the list of Python environments upon opening a Notebook.
 */
@injectable()
export class KernelRefreshIndicator implements IExtensionSyncActivationService {
    private refreshedOnceBefore: boolean = false;
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder
    ) {
        disposables.push(this);
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public activate() {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            this.startRefreshWithPython();
        } else {
            this.startRefreshWithoutPython();
            this.extensionChecker.onPythonExtensionInstallationStatusChanged(
                () => {
                    if (this.extensionChecker.isPythonExtensionInstalled) {
                        this.startRefreshWithPython();
                    }
                },
                this,
                this.disposables
            );
        }
    }
    private startRefreshWithoutPython() {
        if (this.refreshedOnceBefore) {
            return;
        }
        this.refreshedOnceBefore = true;

        const displayProgress = () => {
            const taskNb = notebooks.createNotebookControllerDetectionTask(JupyterNotebookView);
            const taskIW = notebooks.createNotebookControllerDetectionTask(InteractiveWindowView);
            this.disposables.push(taskNb);
            this.disposables.push(taskIW);

            this.kernelFinder.onDidChangeStatus(
                () => {
                    if (this.kernelFinder.status === 'idle') {
                        taskNb.dispose();
                        taskIW.dispose();
                    }
                },
                this,
                this.disposables
            );
        };
        if (this.kernelFinder.status === 'discovering') {
            return displayProgress();
        }

        // Its possible the refresh of kernels has not started,
        // hence the first time we get a non idle status, display the progress indicator.
        // We only do this for the first refresh.
        // Other times the refresh will most likely take place as a result of user hitting refresh button in kernel picker,
        // & at that time we display the progress indicator in the quick pick.
        this.kernelFinder.onDidChangeStatus(
            () => {
                if (this.kernelFinder.status === 'discovering') {
                    displayProgress();
                }
            },
            this,
            this.disposables
        );
    }
    private startRefreshWithPython() {
        if (this.refreshedOnceBefore) {
            return;
        }
        this.refreshedOnceBefore = true;
        const taskNb = notebooks.createNotebookControllerDetectionTask(JupyterNotebookView);
        const taskIW = notebooks.createNotebookControllerDetectionTask(InteractiveWindowView);
        this.disposables.push(taskNb);
        this.disposables.push(taskIW);

        this.interpreterService.refreshInterpreters().finally(() => {
            if (this.kernelFinder.status === 'idle') {
                taskNb.dispose();
                taskIW.dispose();
                return;
            }
            this.kernelFinder.onDidChangeStatus(
                () => {
                    if (this.kernelFinder.status === 'idle') {
                        taskNb.dispose();
                        taskIW.dispose();
                    }
                },
                this,
                this.disposables
            );
        });
    }
}
