// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { notebooks } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { JupyterNotebookView } from '../platform/common/constants';
import { IDisposableRegistry } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { IKernelFinder } from './types';

/**
 * Ensures we refresh the list of Python environments upon opening a Notebook.
 */
@injectable()
export class KernelRefreshIndicator implements IExtensionSyncActivationService {
    private refreshedOnceBefore?: boolean;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder
    ) {}
    public activate() {
        if (this.extensionChecker.isPythonExtensionInstalled) {
            this.startRefresh();
        } else {
            this.extensionChecker.onPythonExtensionInstallationStatusChanged(
                () => {
                    if (this.extensionChecker.isPythonExtensionInstalled) {
                        this.startRefresh();
                    }
                },
                this,
                this.disposables
            );
        }
    }
    private startRefresh() {
        if (this.refreshedOnceBefore) {
            return;
        }
        this.refreshedOnceBefore = true;
        const task = notebooks.createNotebookControllerDetectionTask(JupyterNotebookView);
        this.disposables.push(task);

        this.interpreterService.refreshInterpreters().finally(() => {
            if (this.kernelFinder.status === 'idle') {
                return task.dispose();
            }
            this.kernelFinder.onDidChangeStatus(
                () => {
                    if (this.kernelFinder.status === 'idle') {
                        return task.dispose();
                    }
                },
                this,
                this.disposables
            );
        });
    }
}
