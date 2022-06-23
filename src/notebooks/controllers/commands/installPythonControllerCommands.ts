// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { isPythonKernelConnection } from '../../../kernels/helpers';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../../platform/api/types';
import { IApplicationShell, ICommandManager } from '../../../platform/common/application/types';
import { Commands, PythonExtension, Telemetry } from '../../../platform/common/constants';
import { ContextKey } from '../../../platform/common/contextKey';
import { IDisposableRegistry, IsWebExtension } from '../../../platform/common/types';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { traceError, traceInfo } from '../../../platform/logging';
import { ProgressReporter } from '../../../platform/progress/progressReporter';
import { sendTelemetryEvent } from '../../../telemetry';
import { IControllerLoader, IControllerRegistration } from '../types';

// This service owns the commands that show up in the kernel picker to allow for either installing
// the Python Extension or installing Python
@injectable()
export class InstallPythonControllerCommands implements IExtensionSingleActivationService {
    private showInstallPythonExtensionContext: ContextKey;
    private showInstallPythonContext: ContextKey;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(IControllerLoader) private readonly controllerLoader: IControllerLoader,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IsWebExtension) private readonly isWeb: boolean
    ) {
        // Context keys to control when these commands are shown
        this.showInstallPythonExtensionContext = new ContextKey(
            'jupyter.showInstallPythonExtensionCommand',
            this.commandManager
        );
        this.showInstallPythonContext = new ContextKey('jupyter.showInstallPythonCommand', this.commandManager);
    }
    public async activate(): Promise<void> {
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

        // We need to know when controllers have been updated so that we can update our context keys
        this.disposables.push(this.controllerLoader.refreshed(this.onNotebookControllersLoaded, this));
    }

    // When the manager loads new controllers we need to check and see if we should enable or disable our context
    // keys that control our commands
    private async onNotebookControllersLoaded() {
        if (!this.isWeb) {
            if (this.controllerRegistration.values.some((item) => isPythonKernelConnection(item.connection))) {
                // We have some type of python kernel, turn off both install helper commands
                await this.showInstallPythonExtensionContext.set(false);
                await this.showInstallPythonContext.set(false);
            } else {
                if (!this.extensionChecker.isPythonExtensionInstalled) {
                    // If we don't have the extension installed, show extension install command
                    await this.showInstallPythonExtensionContext.set(true);
                    await this.showInstallPythonContext.set(false);
                } else {
                    // If we do have the extension installed, show python install command
                    await this.showInstallPythonExtensionContext.set(false);
                    await this.showInstallPythonContext.set(true);
                }
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
            DataScience.pythonNotInstalledNonMarkdown(),
            { modal: true },
            Common.install()
        );

        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
            // Direct the user to download from python.org
            this.appShell.openUrl('https://www.python.org/downloads');
        } else {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
        }
    }

    // Called when we select the command to install the python extension via the kernel picker
    // If new controllers are added before this fully resolves any in progress executions will be
    // passed on, so we can trigger with the run button, install, get a controller and not have to
    // click run again
    private async installPythonExtensionViaKernelPicker(): Promise<void> {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });

            // First present a simple modal dialog to indicate what we are about to do
            const selection = await this.appShell.showInformationMessage(
                DataScience.pythonExtensionRequiredToRunNotebook(),
                { modal: true },
                Common.install()
            );
            if (selection === Common.install()) {
                sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            } else {
                // If they don't want to install, just bail out at this point
                sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
                return;
            }

            // Now start to indicate that we are performing the install and locating kernels
            const reporter = this.progressReporter.createProgressIndicator(DataScience.installingPythonExtension());
            try {
                // Directly install the python extension
                await this.commandManager.executeCommand('workbench.extensions.installExtension', PythonExtension);

                // Don't move forward until we have hooked the API
                // Note extensions.installExtension seems to return "mostly" after the install is done, but at that
                // point we don't see it installed via the checker and don't have the API so wait for it here
                await this.pythonApi.pythonExtensionHooked;

                if (this.extensionChecker.isPythonExtensionInstalled) {
                    traceInfo('Python Extension installed via Kernel Picker command');
                    sendTelemetryEvent(Telemetry.PythonExtensionInstalledViaKernelPicker, undefined, {
                        action: 'success'
                    });

                    // Trigger a load of our notebook controllers, we want to await it here so that any in
                    // progress executions get passed to the suggested controller
                    await this.controllerLoader.loadControllers(true);
                } else {
                    traceError('Failed to install Python Extension via Kernel Picker command');
                    sendTelemetryEvent(Telemetry.PythonExtensionInstalledViaKernelPicker, undefined, {
                        action: 'failed'
                    });
                    throw new Error('Failed to install Python Extension via Kernel Picker command');
                }
            } finally {
                // Always clean up our progress reported
                reporter.dispose();
            }
        }
    }
}
