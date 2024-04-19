// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { commands, window } from 'vscode';
import { IDataScienceErrorHandler } from '../../../kernels/errors/types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { Commands, Telemetry } from '../../../platform/common/constants';
import { IDisposableRegistry } from '../../../platform/common/types';
import { raceTimeout } from '../../../platform/common/utils/async';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import { traceError, traceVerbose } from '../../../platform/logging';
import { ProgressReporter } from '../../../platform/progress/progressReporter';
import { sendTelemetryEvent } from '../../../telemetry';

// This service owns the commands that show up in the kernel picker to allow for either installing
// the Python Extension or installing Python
@injectable()
export class InstallPythonControllerCommands implements IExtensionSyncActivationService {
    private installedOnceBefore?: boolean;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler
    ) {}
    public activate() {
        // Register our commands that will handle installing the python extension or python via the kernel picker
        this.disposables.push(
            commands.registerCommand(
                Commands.InstallPythonExtensionViaKernelPicker,
                this.installPythonExtensionViaKernelPicker,
                this
            )
        );
        this.disposables.push(
            commands.registerCommand(Commands.InstallPythonViaKernelPicker, this.installPythonViaKernelPicker, this)
        );
    }

    // This is called via the "install python" command in the kernel picker in the case where
    // we have the python extension installed, but 0 valid python kernels / interpreters found
    // just pop up a dialog box to prompt the user on how to install python
    // Unlike installing the python extension we don't expect in progress executions to be handled
    // when this command is installed, user will have to manually install python and rerun the cell
    private async installPythonViaKernelPicker(): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'displayed' });
        const buttons = this.installedOnceBefore ? [Common.install, Common.reload] : [Common.install];
        const selection = await window.showErrorMessage(DataScience.pythonNotInstalled, { modal: true }, ...buttons);

        if (selection === Common.install) {
            this.installedOnceBefore = true;
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
            // Activate the python extension command to show how to install python
            await commands.executeCommand('python.installPython');
        } else if (selection === Common.reload) {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'reload' });
            await commands.executeCommand('jupyter.reloadVSCode', DataScience.reloadRequired);
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
                const hooked = 'hooked';
                const hookResult = await raceTimeout(
                    60_000,
                    'timeout',
                    this.pythonApi.pythonExtensionHooked.then(() => hooked)
                );

                // Make sure that we didn't timeout waiting for the hook
                if (this.extensionChecker.isPythonExtensionInstalled && hookResult === hooked) {
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
