// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { notebooks, window, workspace } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { traceVerbose } from '../platform/logging';
import { IKernelFinder } from './types';
import { isJupyterNotebook } from '../platform/common/utils';
import { noop } from '../platform/common/utils/misc';
import { DisposableStore } from '../platform/common/utils/lifecycle';

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
        dispose(this.disposables);
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
            const id = Date.now().toString();
            traceVerbose(`Start refreshing Kernel Picker (${id})`);
            const taskNb = notebooks.createNotebookControllerDetectionTask(JupyterNotebookView);
            const taskIW = notebooks.createNotebookControllerDetectionTask(InteractiveWindowView);
            this.disposables.push(taskNb);
            this.disposables.push(taskIW);

            this.kernelFinder.onDidChangeStatus(
                () => {
                    if (this.kernelFinder.status === 'idle') {
                        traceVerbose(`End refreshing Kernel Picker (${id})`);
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
        let refreshedInterpreters = false;
        window.onDidChangeActiveNotebookEditor(
            (e) => {
                if (!refreshedInterpreters && e && isJupyterNotebook(e.notebook)) {
                    refreshedInterpreters = true;
                    traceVerbose(`Start refreshing Interpreter Kernel Picker`);
                    this.interpreterService.refreshInterpreters().catch(noop);
                }
            },
            this,
            this.disposables
        );
        workspace.onDidOpenNotebookDocument(
            (e) => {
                if (!refreshedInterpreters && isJupyterNotebook(e)) {
                    refreshedInterpreters = true;
                    traceVerbose(`Start refreshing Interpreter Kernel Picker`);
                    this.interpreterService.refreshInterpreters().catch(noop);
                }
            },
            this,
            this.disposables
        );

        let kernelProgress: DisposableStore | undefined;
        let id: string = '';
        const createProgressIndicator = () => {
            if (kernelProgress && !kernelProgress.isDisposed) {
                return kernelProgress;
            }
            id = Date.now().toString();
            traceVerbose(`Start refreshing Kernel Picker (${id})`);
            kernelProgress = new DisposableStore(
                notebooks.createNotebookControllerDetectionTask(JupyterNotebookView),
                notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            );
            this.disposables.push(kernelProgress);
            return kernelProgress;
        };

        if (this.kernelFinder.status === 'idle') {
            traceVerbose(`End refreshing Kernel Picker (${id})`);
            kernelProgress?.dispose();
        } else {
            createProgressIndicator();
        }
        this.kernelFinder.onDidChangeStatus(
            () => {
                if (this.kernelFinder.status === 'idle') {
                    traceVerbose(`End refreshing Kernel Picker (${id})`);
                    kernelProgress?.dispose();
                } else {
                    createProgressIndicator();
                }
            },
            this,
            this.disposables
        );
    }
}
