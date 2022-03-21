// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { JupyterInstallError } from './jupyterInstallError';
import { JupyterSelfCertsError } from './jupyterSelfCertsError';
import {
    CancellationError,
    CancellationError as VscCancellationError,
    CancellationTokenSource,
    ConfigurationTarget,
    workspace
} from 'vscode';
import { KernelConnectionTimeoutError } from './kernelConnectionTimeoutError';
import { KernelDiedError } from './kernelDiedError';
import { KernelPortNotUsedTimeoutError } from './kernelPortNotUsedTimeoutError';
import { KernelProcessExitedError } from './kernelProcessExitedError';
import { IApplicationShell, IWorkspaceService } from '../../client/common/application/types';
import { traceWarning } from '../../client/common/logger';
import { IBrowserService, IConfigurationService, Resource } from '../../client/common/types';
import { DataScience, Common } from '../../client/common/utils/localize';
import { DisplayOptions } from '../../client/datascience/displayOptions';
import {
    IDataScienceErrorHandler,
    IJupyterInterpreterDependencyManager,
    IKernelDependencyService,
    KernelInterpreterDependencyResponse
} from '../../client/datascience/types';
import { sendTelemetryEvent } from '../../client/telemetry';
import { Telemetry, Commands } from '../../datascience-ui/common/constants';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { translateProductToModule } from '../../kernels/installer/moduleInstaller';
import { ProductNames } from '../../kernels/installer/productNames';
import { Product } from '../../kernels/installer/types';
import { JupyterInterpreterDependencyResponse } from '../../kernels/jupyter/interpreter/jupyterInterpreterDependencyService';
import { KernelConnectionMetadata } from '../../kernels/types';
import { analyzeKernelErrors, KernelFailureReason, getErrorMessageFromPythonTraceback } from './errorUtils';
import { JupyterConnectError } from './jupyterConnectError';
import { JupyterKernelDependencyError } from './jupyterKernelDependencyError';
import { WrappedError, BaseKernelError, WrappedKernelError, BaseError } from './types';
import { noop } from '../../client/common/utils/misc';
import { EnvironmentType } from '../../client/pythonEnvironments/info';
import { KernelDeadError } from './kernelDeadError';

@injectable()
export class DataScienceErrorHandler implements IDataScienceErrorHandler {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager)
        private readonly dependencyManager: IJupyterInterpreterDependencyManager,
        @inject(IBrowserService) private readonly browser: IBrowserService,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IKernelDependencyService) private readonly kernelDependency: IKernelDependencyService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService
    ) {}
    public async handleError(err: Error): Promise<void> {
        traceWarning('DataScience Error', err);
        err = WrappedError.unwrap(err);
        if (err instanceof JupyterInstallError) {
            await this.dependencyManager.installMissingDependencies(err);
        } else if (err instanceof JupyterSelfCertsError) {
            // On a self cert error, warn the user and ask if they want to change the setting
            const enableOption: string = DataScience.jupyterSelfCertEnable();
            const closeOption: string = DataScience.jupyterSelfCertClose();
            await this.applicationShell
                .showErrorMessage(DataScience.jupyterSelfCertFail().format(err.message), enableOption, closeOption)
                .then((value) => {
                    if (value === enableOption) {
                        sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
                        void this.configuration.updateSetting(
                            'allowUnauthorizedRemoteConnection',
                            true,
                            undefined,
                            ConfigurationTarget.Workspace
                        );
                    } else if (value === closeOption) {
                        sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
                    }
                });
        } else if (err instanceof VscCancellationError || err instanceof CancellationError) {
            // Don't show the message for cancellation errors
            traceWarning(`Cancelled by user`, err);
        } else if (err instanceof KernelConnectionTimeoutError || err instanceof KernelPortNotUsedTimeoutError) {
            this.applicationShell.showErrorMessage(err.message).then(noop, noop);
        } else if (
            err instanceof KernelDiedError ||
            err instanceof KernelProcessExitedError ||
            err instanceof JupyterConnectError
        ) {
            this.applicationShell.showErrorMessage(getUserFriendlyErrorMessage(err)).then(noop, noop);
        } else {
            // Some errors have localized and/or formatted error messages.
            const message = getCombinedErrorMessage(err.message || err.toString());
            this.applicationShell.showErrorMessage(message).then(noop, noop);
        }
    }
    public async getErrorMessageForDisplayInCell(
        error: Error,
        context: 'start' | 'restart' | 'interrupt' | 'execution'
    ) {
        error = WrappedError.unwrap(error);
        if (error instanceof KernelDeadError) {
            // When we get this we've already asked the user to restart the kernel,
            // No need to display errors in each cell.
            return '';
        } else if (error instanceof JupyterKernelDependencyError) {
            return getIPyKernelMissingErrorMessageForCell(error.kernelConnectionMetadata) || error.message;
        } else if (error instanceof JupyterInstallError) {
            return getJupyterMissingErrorMessageForCell(error) || error.message;
        } else if (error instanceof VscCancellationError || error instanceof CancellationError) {
            // Don't show the message for cancellation errors
            traceWarning(`Cancelled by user`, error);
            return '';
        } else if (
            (error instanceof KernelDiedError || error instanceof KernelProcessExitedError) &&
            (error.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                error.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter') &&
            error.kernelConnectionMetadata.interpreter &&
            !(await this.kernelDependency.areDependenciesInstalled(error.kernelConnectionMetadata, undefined, true))
        ) {
            // We don't look for ipykernel dependencies before we start a kernel, hence
            // its possible the kernel failed to start due to missing dependencies.
            return getIPyKernelMissingErrorMessageForCell(error.kernelConnectionMetadata) || error.message;
        } else if (error instanceof BaseKernelError || error instanceof WrappedKernelError) {
            const failureInfo = analyzeKernelErrors(
                workspace.workspaceFolders || [],
                error,
                getDisplayNameOrNameOfKernelConnection(error.kernelConnectionMetadata),
                error.kernelConnectionMetadata.interpreter?.sysPrefix
            );
            if (failureInfo) {
                // Special case for ipykernel module missing.
                if (
                    failureInfo.reason === KernelFailureReason.moduleNotFoundFailure &&
                    ['ipykernel_launcher', 'ipykernel'].includes(failureInfo.moduleName)
                ) {
                    return getIPyKernelMissingErrorMessageForCell(error.kernelConnectionMetadata) || error.message;
                }
                const messageParts = [failureInfo.message];
                if (failureInfo.moreInfoLink) {
                    messageParts.push(Common.clickHereForMoreInfoWithHtml().format(failureInfo.moreInfoLink));
                }
                return messageParts.join('\n');
            }
        }
        return getUserFriendlyErrorMessage(error, context);
    }
    public async handleKernelError(
        err: Error,
        context: 'start' | 'restart' | 'interrupt' | 'execution',
        kernelConnection: KernelConnectionMetadata,
        resource: Resource
    ): Promise<KernelInterpreterDependencyResponse> {
        traceWarning('Kernel Error', err);
        err = WrappedError.unwrap(err);

        // Jupyter kernels, non zmq actually do the dependency install themselves
        if (err instanceof JupyterKernelDependencyError) {
            return err.reason;
            // Use the kernel dependency service to first determine if this is because dependencies are missing or not
        } else if ((context === 'start' || context === 'restart') && err instanceof JupyterInstallError) {
            const response = await this.dependencyManager.installMissingDependencies(err);
            return response === JupyterInterpreterDependencyResponse.ok
                ? KernelInterpreterDependencyResponse.ok
                : KernelInterpreterDependencyResponse.cancel;
        } else if (err instanceof JupyterSelfCertsError) {
            // On a self cert error, warn the user and ask if they want to change the setting
            const enableOption: string = DataScience.jupyterSelfCertEnable();
            const closeOption: string = DataScience.jupyterSelfCertClose();
            void this.applicationShell
                .showErrorMessage(DataScience.jupyterSelfCertFail().format(err.message), enableOption, closeOption)
                .then((value) => {
                    if (value === enableOption) {
                        sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
                        void this.configuration.updateSetting(
                            'allowUnauthorizedRemoteConnection',
                            true,
                            undefined,
                            ConfigurationTarget.Workspace
                        );
                    } else if (value === closeOption) {
                        sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
                    }
                });
            return KernelInterpreterDependencyResponse.failed;
        } else if (err instanceof VscCancellationError || err instanceof CancellationError) {
            // Don't show the message for cancellation errors
            traceWarning(`Cancelled by user`, err);
            return KernelInterpreterDependencyResponse.cancel;
        } else if (
            (context === 'start' || context === 'restart') &&
            !(await this.kernelDependency.areDependenciesInstalled(kernelConnection, undefined, true))
        ) {
            const tokenSource = new CancellationTokenSource();
            try {
                return this.kernelDependency.installMissingDependencies(
                    resource,
                    kernelConnection,
                    new DisplayOptions(false),
                    tokenSource.token,
                    true
                );
            } finally {
                tokenSource.dispose();
            }
        } else {
            const failureInfo = analyzeKernelErrors(
                this.workspaceService.workspaceFolders || [],
                err,
                getDisplayNameOrNameOfKernelConnection(kernelConnection),
                kernelConnection.interpreter?.sysPrefix
            );
            if (failureInfo) {
                void this.showMessageWithMoreInfo(failureInfo?.message, failureInfo?.moreInfoLink);
            } else {
                // These are generic errors, we have no idea what went wrong,
                // hence add a descriptive prefix (message), that provides more context to the user.
                void this.showMessageWithMoreInfo(getUserFriendlyErrorMessage(err, context));
            }
            return KernelInterpreterDependencyResponse.failed;
        }
    }
    private async showMessageWithMoreInfo(message: string, moreInfoLink?: string) {
        if (!message.includes(Commands.ViewJupyterOutput)) {
            message = `${message} \n${DataScience.viewJupyterLogForFurtherInfo()}`;
        }
        const buttons = moreInfoLink ? [Common.learnMore()] : [];
        await this.applicationShell.showErrorMessage(message, ...buttons).then((selection) => {
            if (selection === Common.learnMore() && moreInfoLink) {
                this.browser.launch(moreInfoLink);
            }
        });
    }
}
const errorPrefixes = {
    restart: DataScience.failedToRestartKernel(),
    start: DataScience.failedToStartKernel(),
    interrupt: DataScience.failedToInterruptKernel(),
    execution: ''
};
/**
 * Sometimes the errors thrown don't contain user friendly messages,
 * all they contain is some cryptic or stdout or tracebacks.
 * For such messages, provide more context on what went wrong.
 */
function getUserFriendlyErrorMessage(error: Error, context?: 'start' | 'restart' | 'interrupt' | 'execution') {
    error = WrappedError.unwrap(error);
    const errorPrefix = context ? errorPrefixes[context] : '';
    if (error instanceof BaseError) {
        // These are generic errors, we have no idea what went wrong,
        // hence add a descriptive prefix (message), that provides more context to the user.
        return getCombinedErrorMessage(
            errorPrefix,
            getErrorMessageFromPythonTraceback(error.stdErr) || error.stdErr || error.message
        );
    } else {
        // These are generic errors, we have no idea what went wrong,
        // hence add a descriptive prefix (message), that provides more context to the user.
        return getCombinedErrorMessage(errorPrefix, error.message);
    }
}
function getCombinedErrorMessage(prefix?: string, message?: string) {
    const errorMessage = [prefix || '', message || '']
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(' \n');
    if (errorMessage.length && errorMessage.indexOf('command:jupyter.viewOutput') === -1) {
        return `${
            errorMessage.endsWith('.') ? errorMessage : errorMessage + '.'
        } \n${DataScience.viewJupyterLogForFurtherInfo()}`;
    }
    return errorMessage;
}
function getIPyKernelMissingErrorMessageForCell(kernelConnection: KernelConnectionMetadata) {
    if (
        kernelConnection.kind === 'connectToLiveKernel' ||
        kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
        !kernelConnection.interpreter
    ) {
        return;
    }
    const displayNameOfKernel = kernelConnection.interpreter.displayName || kernelConnection.interpreter.path;
    const ipyKernelName = ProductNames.get(Product.ipykernel)!;
    const ipyKernelModuleName = translateProductToModule(Product.ipykernel);

    let installerCommand = `${kernelConnection.interpreter.path.fileToCommandArgument()} -m pip install ${ipyKernelModuleName} -U --force-reinstall`;
    if (kernelConnection.interpreter?.envType === EnvironmentType.Conda) {
        if (kernelConnection.interpreter?.envName) {
            installerCommand = `conda install -n ${kernelConnection.interpreter?.envName} ${ipyKernelModuleName} --update-deps --force-reinstall`;
        } else if (kernelConnection.interpreter?.envPath) {
            installerCommand = `conda install -p ${kernelConnection.interpreter?.envPath} ${ipyKernelModuleName} --update-deps --force-reinstall`;
        }
    } else if (
        kernelConnection.interpreter?.envType === EnvironmentType.Global ||
        kernelConnection.interpreter?.envType === EnvironmentType.WindowsStore ||
        kernelConnection.interpreter?.envType === EnvironmentType.System
    ) {
        installerCommand = `${kernelConnection.interpreter.path.fileToCommandArgument()} -m pip install ${ipyKernelModuleName} -U --user --force-reinstall`;
    }
    const message = DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter().format(
        displayNameOfKernel,
        ProductNames.get(Product.ipykernel)!
    );
    const installationInstructions = DataScience.installPackageInstructions().format(ipyKernelName, installerCommand);
    return message + '\n' + installationInstructions;
}
function getJupyterMissingErrorMessageForCell(err: JupyterInstallError) {
    const productNames = `${ProductNames.get(Product.jupyter)} ${Common.and()} ${ProductNames.get(Product.notebook)}`;
    const moduleNames = [Product.jupyter, Product.notebook].map(translateProductToModule).join(' ');

    const installerCommand = `python -m pip install ${moduleNames} -U\nor\nconda install ${moduleNames} -U`;
    const installationInstructions = DataScience.installPackageInstructions().format(productNames, installerCommand);

    return (
        err.message +
        '\n' +
        installationInstructions +
        '\n' +
        Common.clickHereForMoreInfoWithHtml().format('https://aka.ms/installJupyterForVSCode')
    );
}
