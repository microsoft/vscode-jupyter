// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable, optional } from 'inversify';
import { JupyterInstallError } from './jupyterInstallError';
import { JupyterSelfCertsError } from './jupyterSelfCertsError';
import {
    CancellationError as VscCancellationError,
    CancellationTokenSource,
    ConfigurationTarget,
    workspace
} from 'vscode';
import { KernelConnectionTimeoutError } from './kernelConnectionTimeoutError';
import { KernelDiedError } from './kernelDiedError';
import { KernelPortNotUsedTimeoutError } from './kernelPortNotUsedTimeoutError';
import { KernelProcessExitedError } from './kernelProcessExitedError';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../common/application/types';
import { traceError, traceWarning } from '../logging';
import { IBrowserService, IConfigurationService, IExtensions, IsWebExtension, Resource } from '../common/types';
import { DataScience, Common } from '../common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry, Commands } from '../../webviews/webview-side/common/constants';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { translateProductToModule } from '../../kernels/installer/utils';
import { ProductNames } from '../../kernels/installer/productNames';
import { Product } from '../../kernels/installer/types';
import {
    IKernelDependencyService,
    KernelAction,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse
} from '../../kernels/types';
import { analyzeKernelErrors, KernelFailureReason, getErrorMessageFromPythonTraceback } from './errorUtils';
import { JupyterConnectError } from './jupyterConnectError';
import { JupyterKernelDependencyError } from './jupyterKernelDependencyError';
import { WrappedError, BaseKernelError, WrappedKernelError, BaseError, IDataScienceErrorHandler } from './types';
import { noop } from '../common/utils/misc';
import { EnvironmentType } from '../pythonEnvironments/info';
import { KernelDeadError } from './kernelDeadError';
import { DisplayOptions } from '../../kernels/displayOptions';
import {
    IJupyterInterpreterDependencyManager,
    IJupyterServerUriStorage,
    JupyterInterpreterDependencyResponse
} from '../../kernels/jupyter/types';
import { handleExpiredCertsError, handleSelfCertsError } from '../../kernels/jupyter/jupyterUtils';
import { getFilePath } from '../common/platform/fs-paths';
import { CancellationError } from '../common/cancellation';
import { JupyterExpiredCertsError } from './jupyterExpiredCertsError';
import { computeServerId } from '../../kernels/jupyter/jupyterUtils';
import { RemoteJupyterServerConnectionError } from './remoteJupyterServerConnectionError';
import { RemoteJupyterServerUriProviderError } from './remoteJupyterServerUriProviderError';
import { InvalidRemoteJupyterServerUriHandleError } from './invalidRemoteJupyterServerUriHandleError';

@injectable()
export class DataScienceErrorHandler implements IDataScienceErrorHandler {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager)
        @optional()
        private readonly dependencyManager: IJupyterInterpreterDependencyManager | undefined,
        @inject(IBrowserService) private readonly browser: IBrowserService,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IKernelDependencyService)
        @optional()
        private readonly kernelDependency: IKernelDependencyService | undefined,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IsWebExtension) private readonly isWebExtension: boolean,
        @inject(IExtensions) private readonly extensions: IExtensions
    ) {}
    private handledErrors = new WeakSet<Error>();
    public async handleError(err: Error): Promise<void> {
        traceWarning('DataScience Error', err);
        err = WrappedError.unwrap(err);
        if (this.handledErrors.has(err)) {
            return;
        }
        this.handledErrors.add(err);
        if (err instanceof JupyterInstallError) {
            await this.dependencyManager?.installMissingDependencies(err);
        } else if (err instanceof JupyterSelfCertsError) {
            await handleSelfCertsError(this.applicationShell, this.configuration, err.message);
        } else if (err instanceof JupyterExpiredCertsError) {
            await handleExpiredCertsError(this.applicationShell, this.configuration, err.message);
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
        } else if (err instanceof RemoteJupyterServerConnectionError && this.isWebExtension) {
            // Special case for a failure on web
            this.applicationShell
                .showErrorMessage(DataScience.jupyterNotebookRemoteConnectFailedWeb().format(err.baseUrl))
                .then(noop, noop);
        } else {
            // Some errors have localized and/or formatted error messages.
            const message = getCombinedErrorMessage(err.message || err.toString());
            this.applicationShell.showErrorMessage(message).then(noop, noop);
        }
    }
    public async getErrorMessageForDisplayInCell(error: Error, errorContext: KernelAction) {
        error = WrappedError.unwrap(error);
        traceError(`Error in execution (get message for cell)`, error);
        if (error instanceof KernelDeadError) {
            // When we get this we've already asked the user to restart the kernel,
            // No need to display errors in each cell.
            return '';
        } else if (error instanceof JupyterKernelDependencyError) {
            return getIPyKernelMissingErrorMessageForCell(error.kernelConnectionMetadata) || error.message;
        } else if (error instanceof JupyterInstallError) {
            return getJupyterMissingErrorMessageForCell(error) || error.message;
        } else if (error instanceof RemoteJupyterServerConnectionError && !this.isWebExtension) {
            return error.message;
        } else if (error instanceof RemoteJupyterServerConnectionError && this.isWebExtension) {
            return DataScience.jupyterNotebookRemoteConnectFailedWeb().format(error.baseUrl);
        } else if (error instanceof VscCancellationError || error instanceof CancellationError) {
            // Don't show the message for cancellation errors
            traceWarning(`Cancelled by user`, error);
            return '';
        } else if (
            (error instanceof KernelDiedError || error instanceof KernelProcessExitedError) &&
            (error.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                error.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter') &&
            error.kernelConnectionMetadata.interpreter &&
            this.kernelDependency &&
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
        } else if (
            error instanceof RemoteJupyterServerConnectionError ||
            error instanceof RemoteJupyterServerUriProviderError
        ) {
            const savedList = await this.serverUriStorage.getSavedUriList();
            const message =
                error instanceof RemoteJupyterServerConnectionError
                    ? error.originalError.message || ''
                    : error.originalError?.message || error.message;
            const serverId = error instanceof RemoteJupyterServerConnectionError ? error.serverId : error.serverId;
            const displayName = savedList.find((item) => computeServerId(item.uri) === serverId)?.displayName;
            const baseUrl = error instanceof RemoteJupyterServerConnectionError ? error.baseUrl : '';
            const idAndHandle =
                error instanceof RemoteJupyterServerUriProviderError ? `${error.providerId}:${error.handle}` : '';
            const serverName =
                displayName && baseUrl ? `${displayName} (${baseUrl})` : displayName || baseUrl || idAndHandle;

            return getUserFriendlyErrorMessage(
                DataScience.remoteJupyterConnectionFailedWithServerWithError().format(serverName, message),
                errorContext
            );
        } else if (error instanceof InvalidRemoteJupyterServerUriHandleError) {
            const extensionName =
                this.extensions.getExtension(error.extensionId)?.packageJSON.displayName || error.extensionId;
            return getUserFriendlyErrorMessage(
                DataScience.remoteJupyterServerProvidedBy3rdPartyExtensionNoLongerValid().format(extensionName),
                errorContext
            );
        }

        return getUserFriendlyErrorMessage(error, errorContext);
    }
    public async handleKernelError(
        err: Error,
        errorContext: KernelAction,
        kernelConnection: KernelConnectionMetadata,
        resource: Resource,
        actionSource: KernelActionSource
    ): Promise<KernelInterpreterDependencyResponse> {
        traceWarning(`Kernel Error, context = ${errorContext}`, err);
        err = WrappedError.unwrap(err);

        // Jupyter kernels, non zmq actually do the dependency install themselves
        if (err instanceof CancellationError || err instanceof VscCancellationError) {
            return KernelInterpreterDependencyResponse.cancel;
        } else if (err instanceof JupyterKernelDependencyError) {
            traceWarning(`Jupyter Kernel Dependency Error, reason=${err.reason}`, err);
            if (err.reason === KernelInterpreterDependencyResponse.uiHidden) {
                // At this point we're handling the error, and if the error was initially swallowed due to
                // auto start (ui hidden), now we need to display the error to the user.
                const response = this.dependencyManager
                    ? await this.dependencyManager.installMissingDependencies(err)
                    : JupyterInterpreterDependencyResponse.cancel;
                return response === JupyterInterpreterDependencyResponse.ok
                    ? KernelInterpreterDependencyResponse.ok
                    : KernelInterpreterDependencyResponse.cancel;
            } else {
                return err.reason;
            }
            // Use the kernel dependency service to first determine if this is because dependencies are missing or not
        } else if ((errorContext === 'start' || errorContext === 'restart') && err instanceof JupyterInstallError) {
            const response = this.dependencyManager
                ? await this.dependencyManager.installMissingDependencies(err)
                : JupyterInterpreterDependencyResponse.cancel;
            return response === JupyterInterpreterDependencyResponse.ok
                ? KernelInterpreterDependencyResponse.ok
                : KernelInterpreterDependencyResponse.cancel;
        } else if (
            err instanceof RemoteJupyterServerConnectionError ||
            err instanceof RemoteJupyterServerUriProviderError ||
            err instanceof InvalidRemoteJupyterServerUriHandleError
        ) {
            const savedList = await this.serverUriStorage.getSavedUriList();
            const message =
                err instanceof InvalidRemoteJupyterServerUriHandleError
                    ? ''
                    : err instanceof RemoteJupyterServerConnectionError
                    ? err.originalError.message || ''
                    : err.originalError?.message || err.message;
            const serverId = err instanceof RemoteJupyterServerConnectionError ? err.serverId : err.serverId;
            const displayName = savedList.find((item) => computeServerId(item.uri) === serverId)?.displayName;
            const baseUrl = err instanceof RemoteJupyterServerConnectionError ? err.baseUrl : '';
            const idAndHandle =
                err instanceof RemoteJupyterServerUriProviderError ? `${err.providerId}:${err.handle}` : '';
            const serverName =
                displayName && baseUrl ? `${displayName} (${baseUrl})` : displayName || baseUrl || idAndHandle;
            const extensionName =
                err instanceof InvalidRemoteJupyterServerUriHandleError
                    ? this.extensions.getExtension(err.extensionId)?.packageJSON.displayName || err.extensionId
                    : '';
            const selection = await this.applicationShell.showErrorMessage(
                err instanceof InvalidRemoteJupyterServerUriHandleError
                    ? DataScience.remoteJupyterServerProvidedBy3rdPartyExtensionNoLongerValid().format(extensionName)
                    : DataScience.remoteJupyterConnectionFailedWithServer().format(serverName),
                { detail: message, modal: true },
                DataScience.removeRemoteJupyterConnectionButtonText(),
                DataScience.changeRemoteJupyterConnectionButtonText(),
                DataScience.selectDifferentKernel()
            );
            switch (selection) {
                case DataScience.removeRemoteJupyterConnectionButtonText(): {
                    // Start with saved list.
                    const uriList = await this.serverUriStorage.getSavedUriList();

                    // Remove this uri if already found (going to add again with a new time)
                    const item = uriList.find((f) => computeServerId(f.uri) === serverId);
                    if (item) {
                        await this.serverUriStorage.removeUri(item.uri);
                    }
                    // Wait until all of the remote controllers associated with this server have been removed.
                    return KernelInterpreterDependencyResponse.cancel;
                }
                case DataScience.changeRemoteJupyterConnectionButtonText(): {
                    await this.commandManager.executeCommand(
                        Commands.SelectJupyterURI,
                        true,
                        'errorHandler',
                        undefined
                    );
                    return KernelInterpreterDependencyResponse.cancel;
                }
                case DataScience.selectDifferentKernel(): {
                    return KernelInterpreterDependencyResponse.selectDifferentKernel;
                }
            }
            return KernelInterpreterDependencyResponse.cancel;
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
            (errorContext === 'start' || errorContext === 'restart') &&
            this.kernelDependency &&
            !(await this.kernelDependency.areDependenciesInstalled(kernelConnection, undefined, true))
        ) {
            const tokenSource = new CancellationTokenSource();
            try {
                const cannotChangeKernel = actionSource === '3rdPartyExtension';
                return this.kernelDependency.installMissingDependencies(
                    resource,
                    kernelConnection,
                    new DisplayOptions(false),
                    tokenSource.token,
                    true,
                    cannotChangeKernel
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
                void this.showMessageWithMoreInfo(getUserFriendlyErrorMessage(err, errorContext));
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
function getUserFriendlyErrorMessage(error: Error | string, errorContext?: KernelAction) {
    error = typeof error === 'string' ? error : WrappedError.unwrap(error);
    const errorPrefix = errorContext ? errorPrefixes[errorContext] : '';
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
        const errorMessage = typeof error === 'string' ? error : error.message;
        return getCombinedErrorMessage(errorPrefix, errorMessage);
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
        kernelConnection.kind === 'connectToLiveRemoteKernel' ||
        kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
        !kernelConnection.interpreter
    ) {
        return;
    }
    const displayNameOfKernel =
        kernelConnection.interpreter.displayName || getFilePath(kernelConnection.interpreter.uri);
    const ipyKernelName = ProductNames.get(Product.ipykernel)!;
    const ipyKernelModuleName = translateProductToModule(Product.ipykernel);

    let installerCommand = `${getFilePath(
        kernelConnection.interpreter.uri
    ).fileToCommandArgument()} -m pip install ${ipyKernelModuleName} -U --force-reinstall`;
    if (kernelConnection.interpreter?.envType === EnvironmentType.Conda) {
        if (kernelConnection.interpreter?.envName) {
            installerCommand = `conda install -n ${kernelConnection.interpreter?.envName} ${ipyKernelModuleName} --update-deps --force-reinstall`;
        } else if (kernelConnection.interpreter?.envPath) {
            installerCommand = `conda install -p ${getFilePath(
                kernelConnection.interpreter?.envPath
            )} ${ipyKernelModuleName} --update-deps --force-reinstall`;
        }
    } else if (
        kernelConnection.interpreter?.envType === EnvironmentType.Global ||
        kernelConnection.interpreter?.envType === EnvironmentType.WindowsStore ||
        kernelConnection.interpreter?.envType === EnvironmentType.System
    ) {
        installerCommand = `${getFilePath(
            kernelConnection.interpreter.uri
        ).fileToCommandArgument()} -m pip install ${ipyKernelModuleName} -U --user --force-reinstall`;
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
