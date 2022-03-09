// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { BaseError, BaseKernelError, WrappedError, WrappedKernelError } from '../../common/errors/types';
import { traceWarning } from '../../common/logger';
import { Common, DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { JupyterInstallError } from './jupyterInstallError';
import { JupyterSelfCertsError } from './jupyterSelfCertsError';
import { getDisplayNameOrNameOfKernelConnection, getLanguageInNotebookMetadata } from '../jupyter/kernels/helpers';
import { isPythonNotebook } from '../notebook/helpers/helpers';
import {
    IDataScienceErrorHandler,
    IJupyterInterpreterDependencyManager,
    IKernelDependencyService,
    KernelInterpreterDependencyResponse
} from '../types';
import {
    CancellationError as VscCancellationError,
    CancellationTokenSource,
    ConfigurationTarget,
    workspace
} from 'vscode';
import { CancellationError } from '../../common/cancellation';
import { KernelConnectionTimeoutError } from './kernelConnectionTimeoutError';
import { KernelDiedError } from './kernelDiedError';
import { KernelPortNotUsedTimeoutError } from './kernelPortNotUsedTimeoutError';
import { KernelProcessExitedError } from './kernelProcessExitedError';
import {
    analyzeKernelErrors,
    getErrorMessageFromPythonTraceback,
    KernelFailureReason
} from '../../common/errors/errorUtils';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { IBrowserService, IConfigurationService, Product, Resource } from '../../common/types';
import { Commands, Telemetry } from '../constants';
import { sendTelemetryEvent } from '../../telemetry';
import { JupyterConnectError } from './jupyterConnectError';
import { JupyterInterpreterDependencyResponse } from '../jupyter/interpreter/jupyterInterpreterDependencyService';
import { DisplayOptions } from '../displayOptions';
import { JupyterKernelDependencyError } from './jupyterKernelDependencyError';
import { EnvironmentType } from '../../pythonEnvironments/info';
import * as prodNames from '../../common/installer/productNames';
import * as productInstaller from '../../common/installer/productInstaller';

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
            const defaultErrorMessage = getCombinedErrorMessage(
                getErrorMessageFromPythonTraceback(err.stdErr) || err.stdErr
            );
            this.applicationShell.showErrorMessage(defaultErrorMessage).then(noop, noop);
        } else {
            // Some errors have localized and/or formatted error messages.
            const message = getCombinedErrorMessage(err.message || err.toString());
            this.applicationShell.showErrorMessage(message).then(noop, noop);
        }
    }
    public async getErrorMessageForDisplayInCell(error: Error) {
        let message: string = error.message;
        error = WrappedError.unwrap(error);
        if (error instanceof JupyterKernelDependencyError) {
            message = getIPyKernelMissingErrorMessageForCell(error.kernelConnectionMetadata) || message;
        } else if (error instanceof JupyterInstallError) {
            message = getJupyterMissingErrorMessageForCell(error) || message;
        } else if (
            error instanceof KernelDiedError &&
            (error.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                error.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter') &&
            error.kernelConnectionMetadata.interpreter &&
            !(await this.kernelDependency.areDependenciesInstalled(error.kernelConnectionMetadata, undefined, true))
        ) {
            // We don't look for ipykernel dependencies before we start a kernel, hence
            // its possible the kernel failed to start due to missing dependencies.
            message = getIPyKernelMissingErrorMessageForCell(error.kernelConnectionMetadata) || message;
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
                    return getIPyKernelMissingErrorMessageForCell(error.kernelConnectionMetadata) || message;
                }
                const messageParts = [failureInfo.message];
                if (failureInfo.moreInfoLink) {
                    messageParts.push(Common.clickHereForMoreInfoWithHtml().format(failureInfo.moreInfoLink));
                }
                return messageParts.join('\n');
            }
            return getCombinedErrorMessage(getErrorMessageFromPythonTraceback(error.stdErr) || error.stdErr);
        } else if (error instanceof BaseError) {
            return getCombinedErrorMessage(getErrorMessageFromPythonTraceback(error.stdErr) || error.stdErr);
        }
        return message;
    }
    public async handleKernelError(
        err: Error,
        purpose: 'start' | 'restart' | 'interrupt' | 'execution',
        kernelConnection: KernelConnectionMetadata,
        resource: Resource
    ): Promise<KernelInterpreterDependencyResponse> {
        traceWarning('Kernel Error', err);
        err = WrappedError.unwrap(err);

        // Jupyter kernels, non zmq actually do the dependency install themselves
        if (err instanceof JupyterKernelDependencyError) {
            return err.reason;
            // Use the kernel dependency service to first determine if this is because dependencies are missing or not
        } else if ((purpose === 'start' || purpose === 'restart') && err instanceof JupyterInstallError) {
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
            (purpose === 'start' || purpose === 'restart') &&
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
            } else if (err instanceof BaseError) {
                const message = getCombinedErrorMessage(getErrorMessageFromPythonTraceback(err.stdErr) || err.stdErr);
                void this.showMessageWithMoreInfo(message);
            } else {
                void this.showMessageWithMoreInfo(err.message);
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
function getCombinedErrorMessage(message?: string) {
    const errorMessage = ['', message || '']
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
export function getKernelNotInstalledErrorMessage(notebookMetadata?: nbformat.INotebookMetadata) {
    const language = getLanguageInNotebookMetadata(notebookMetadata);
    if (isPythonNotebook(notebookMetadata) || !language) {
        return DataScience.pythonNotInstalled();
    } else {
        const kernelName = notebookMetadata?.kernelspec?.display_name || notebookMetadata?.kernelspec?.name || language;
        return DataScience.kernelNotInstalled().format(kernelName);
    }
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
    const ipyKernelName = prodNames.ProductNames.get(Product.ipykernel)!;
    const ipyKernelModuleName = productInstaller.translateProductToModule(Product.ipykernel);

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
        prodNames.ProductNames.get(Product.ipykernel)!
    );
    const installationInstructions = DataScience.installPackageInstructions().format(ipyKernelName, installerCommand);
    return message + '\n' + installationInstructions;
}
function getJupyterMissingErrorMessageForCell(err: JupyterInstallError) {
    const productNames = `${prodNames.ProductNames.get(Product.jupyter)} ${Common.and()} ${prodNames.ProductNames.get(Product.notebook)}`;
    const moduleNames = [Product.jupyter, Product.notebook].map(productInstaller.translateProductToModule).join(' ');

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
