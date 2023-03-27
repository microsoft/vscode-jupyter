// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCell, NotebookCellExecutionState, NotebookCellExecutionStateChangeEvent, notebooks } from 'vscode';
import { IDataScienceErrorHandler } from '../../../kernels/errors/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationShell, ICommandManager } from '../../../platform/common/application/types';
import { Commands, JupyterNotebookView, Telemetry } from '../../../platform/common/constants';
import { IDisposableRegistry } from '../../../platform/common/types';
import { sleep } from '../../../platform/common/utils/async';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { traceError, traceVerbose } from '../../../platform/logging';
import { ProgressReporter } from '../../../platform/progress/progressReporter';
import { sendTelemetryEvent } from '../../../telemetry';

// This service owns the commands that show up in the kernel picker to allow for either installing
// the Python Extension or installing Python
@injectable()
export class InstallPythonControllerCommands implements IExtensionSyncActivationService {
    // WeakSet of executing cells, so they get cleaned up on document close without worrying
    private executingCells: WeakSet<NotebookCell> = new WeakSet<NotebookCell>();
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler
    ) {}
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
