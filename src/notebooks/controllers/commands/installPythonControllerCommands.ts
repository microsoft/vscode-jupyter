// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    NotebookCell,
    NotebookCellExecutionState,
    NotebookCellExecutionStateChangeEvent,
    NotebookEditor,
    notebooks,
    window
} from 'vscode';
import { IDataScienceErrorHandler } from '../../../kernels/errors/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationShell, ICommandManager } from '../../../platform/common/application/types';
import { Commands, JupyterNotebookView, PYTHON_LANGUAGE, Telemetry } from '../../../platform/common/constants';
import { ContextKey } from '../../../platform/common/contextKey';
import { IDisposableRegistry, IsWebExtension } from '../../../platform/common/types';
import { sleep } from '../../../platform/common/utils/async';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { traceError, traceVerbose } from '../../../platform/logging';
import { ProgressReporter } from '../../../platform/progress/progressReporter';
import { sendTelemetryEvent } from '../../../telemetry';
import { getLanguageOfNotebookDocument } from '../../languages/helpers';

// This service owns the commands that show up in the kernel picker to allow for either installing
// the Python Extension or installing Python
@injectable()
export class InstallPythonControllerCommands implements IExtensionSyncActivationService {
    private showInstallPythonExtensionContext: ContextKey;
    private showInstallPythonContext: ContextKey;
    private interpretersRefreshedOnceBefore = false;
    // WeakSet of executing cells, so they get cleaned up on document close without worrying
    private executingCells: WeakSet<NotebookCell> = new WeakSet<NotebookCell>();
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(IsWebExtension) private readonly isWeb: boolean,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {
        // Context keys to control when these commands are shown
        this.showInstallPythonExtensionContext = new ContextKey(
            'jupyter.showInstallPythonExtensionCommand',
            this.commandManager
        );
        this.showInstallPythonContext = new ContextKey('jupyter.showInstallPythonCommand', this.commandManager);
    }
    public activate() {
        this.disposables.push(
            notebooks.onDidChangeNotebookCellExecutionState(this.onDidChangeNotebookCellExecutionState, this)
        );
        // Register our commands that will handle installing the python extension or python via the kernel picker
        this.disposables.push(
            this.commandManager.registerCommand(
                Commands.InstallPythonExtensionViaKernelPicker,
                this.installPythonExtensionViaKernelPicker,
                this
            )
        );
        this.disposables.push(
            this.commandManager.registerCommand(
                Commands.InstallPythonViaKernelPicker,
                this.installPythonViaKernelPicker,
                this
            )
        );

        // Also track active notebook editor change
        this.disposables.push(window.onDidChangeActiveNotebookEditor(this.onDidChangeActiveNotebookEditor, this));

        this.disposables.push(this.interpreterService.onDidChangeInterpreters(this.onInterpretersChanged, this));
    }

    // Track if there are any cells currently executing or pending
    private onDidChangeNotebookCellExecutionState(stateEvent: NotebookCellExecutionStateChangeEvent) {
        if (stateEvent.cell.notebook.notebookType === JupyterNotebookView) {
            if (
                stateEvent.state === NotebookCellExecutionState.Pending ||
                stateEvent.state === NotebookCellExecutionState.Executing
            ) {
                this.executingCells.add(stateEvent.cell);
            } else if (stateEvent.state === NotebookCellExecutionState.Idle) {
                this.executingCells.delete(stateEvent.cell);
            }
        }
    }

    private async onDidChangeActiveNotebookEditor(editor: NotebookEditor | undefined) {
        if (!this.isWeb && editor && editor.notebook.notebookType === JupyterNotebookView) {
            // Make sure we are only showing these for python notebooks or undefined notebooks
            const lang = getLanguageOfNotebookDocument(editor.notebook);
            if (!lang || lang === PYTHON_LANGUAGE) {
                if (!this.extensionChecker.isPythonExtensionInstalled) {
                    // Python or undefined notebook with no extension, recommend installing extension
                    await this.showInstallPythonExtensionContext.set(true);
                    await this.showInstallPythonContext.set(false);
                    return;
                }

                // Python extension is installed, let's wait for interpreters to be detected
                if (!this.interpreterService.environmentsFound && !this.interpretersRefreshedOnceBefore) {
                    this.interpretersRefreshedOnceBefore = true;
                    await this.interpreterService.refreshInterpreters();
                }

                if (!this.interpreterService.environmentsFound) {
                    // Extension is installed, but we didn't find any python connections
                    // recommend installing python in this case
                    await this.showInstallPythonExtensionContext.set(false);
                    await this.showInstallPythonContext.set(true);
                    return;
                }
            }
        }

        // Final fallback is to always hide the commands
        await this.showInstallPythonExtensionContext.set(false);
        await this.showInstallPythonContext.set(false);
    }

    // When interpreters change, recalculate our commands as python might have been added or removed
    private async onInterpretersChanged() {
        await this.onDidChangeActiveNotebookEditor(window.activeNotebookEditor);
    }

    // This is called via the "install python" command in the kernel picker in the case where
    // we have the python extension installed, but 0 valid python kernels / interpreters found
    // just pop up a dialog box to prompt the user on how to install python
    // Unlike installing the python extension we don't expect in progress executions to be handled
    // when this command is installed, user will have to manually install python and rerun the cell
    private async installPythonViaKernelPicker(): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showErrorMessage(
            DataScience.pythonNotInstalled,
            { modal: true },
            Common.install
        );

        if (selection === Common.install) {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
            // Activate the python extension command to show how to install python
            await this.commandManager.executeCommand('python.installPython');
        } else {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
        }
    }

    /**
     * Called when we select the command to install the python extension via the kernel picker
     * If new controllers are added before this fully resolves any in progress executions will be
     * passed on, so we can trigger with the run button, install, get a controller and not have to
     * click run again
     *
     * @return {*}  {Promise<boolean>} `true` if Python extension was installed, else not installed.
     */
    private async installPythonExtensionViaKernelPicker(): Promise<boolean | undefined> {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });

            // Now start to indicate that we are performing the install and locating kernels
            const reporter = this.progressReporter.createProgressIndicator(DataScience.installingPythonExtension);
            try {
                await this.extensionChecker.directlyInstallPythonExtension();

                // Don't move forward until we have hooked the API
                // Note extensions.installExtension seems to return "mostly" after the install is done, but at that
                // point we don't see it installed via the checker and don't have the API so wait for it here
                const hookResult = await Promise.race([sleep(60_000), this.pythonApi.pythonExtensionHooked]);

                // Make sure that we didn't timeout waiting for the hook
                if (this.extensionChecker.isPythonExtensionInstalled && typeof hookResult !== 'number') {
                    traceVerbose('Python Extension installed via Kernel Picker command');
                    sendTelemetryEvent(Telemetry.PythonExtensionInstalledViaKernelPicker, undefined, {
                        action: 'success'
                    });

                    return true;
                } else {
                    traceError('Failed to install Python Extension via Kernel Picker command');
                    sendTelemetryEvent(Telemetry.PythonExtensionInstalledViaKernelPicker, undefined, {
                        action: 'failed'
                    });
                    this.errorHandler
                        .handleError(new Error(DataScience.failedToInstallPythonExtension))
                        .then(noop, noop);
                }
            } finally {
                // Always clean up our progress reported
                reporter.dispose();
            }
        }
    }
}
