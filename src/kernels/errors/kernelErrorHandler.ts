// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, optional } from 'inversify';
import { JupyterInstallError } from '../../platform/errors/jupyterInstallError';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { CancellationTokenSource, ConfigurationTarget, Uri, env, extensions, window, workspace } from 'vscode';
import { KernelConnectionTimeoutError } from './kernelConnectionTimeoutError';
import { KernelDiedError } from './kernelDiedError';
import { KernelPortNotUsedTimeoutError } from './kernelPortNotUsedTimeoutError';
import { KernelProcessExitedError } from './kernelProcessExitedError';
import { logger } from '../../platform/logging';
import { IConfigurationService, Resource } from '../../platform/common/types';
import { DataScience, Common } from '../../platform/common/utils/localize';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { Commands, isWebExtension } from '../../platform/common/constants';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { translateProductToModule } from '../../platform/interpreter/installer/utils';
import { ProductNames } from '../../platform/interpreter/installer/productNames';
import { Product } from '../../platform/interpreter/installer/types';
import {
    IKernelDependencyService,
    isLocalConnection,
    KernelAction,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse
} from '../types';
import {
    analyzeKernelErrors,
    KernelFailureReason,
    getErrorMessageFromPythonTraceback
} from '../../platform/errors/errorUtils';
import { JupyterConnectError } from '../../platform/errors/jupyterConnectError';
import { JupyterKernelDependencyError } from './jupyterKernelDependencyError';
import { WrappedError, BaseError, ErrorCategory } from '../../platform/errors/types';
import { noop } from '../../platform/common/utils/misc';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { KernelDeadError } from './kernelDeadError';
import { DisplayOptions } from '../displayOptions';
import {
    IJupyterInterpreterDependencyManager,
    IJupyterServerProviderRegistry,
    IJupyterServerUriStorage,
    JupyterInterpreterDependencyResponse,
    JupyterServerProviderHandle
} from '../jupyter/types';
import { handleExpiredCertsError, handleSelfCertsError } from '../jupyter/jupyterUtils';
import { getDisplayPath, getFilePath } from '../../platform/common/platform/fs-paths';
import { isCancellationError } from '../../platform/common/cancellation';
import { JupyterExpiredCertsError } from '../../platform/errors/jupyterExpiredCertsError';
import { RemoteJupyterServerConnectionError } from '../../platform/errors/remoteJupyterServerConnectionError';
import { RemoteJupyterServerUriProviderError } from './remoteJupyterServerUriProviderError';
import { InvalidRemoteJupyterServerUriHandleError } from './invalidRemoteJupyterServerUriHandleError';
import { BaseKernelError, IDataScienceErrorHandler, WrappedKernelError } from './types';
import { sendKernelTelemetryEvent } from '../telemetry/sendKernelTelemetryEvent';
import { IFileSystem } from '../../platform/common/platform/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { PackageNotInstalledWindowsLongPathNotEnabledError } from '../../platform/errors/packageNotInstalledWindowsLongPathNotEnabledError';
import { JupyterNotebookNotInstalled } from '../../platform/errors/jupyterNotebookNotInstalled';
import { fileToCommandArgument } from '../../platform/common/helpers';
import {
    getCachedEnvironment,
    getEnvironmentType,
    getPythonEnvDisplayName,
    getPythonEnvironmentName,
    getSysPrefix
} from '../../platform/interpreter/helpers';
import { JupyterServerCollection } from '../../api';
import { getJupyterDisplayName } from '../jupyter/connection/jupyterServerProviderRegistry';

/***
 * Common code for handling errors.
 */
export abstract class DataScienceErrorHandler implements IDataScienceErrorHandler {
    constructor(
        @inject(IJupyterInterpreterDependencyManager)
        @optional()
        private readonly dependencyManager: IJupyterInterpreterDependencyManager | undefined,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IKernelDependencyService)
        @optional()
        private readonly kernelDependency: IKernelDependencyService | undefined,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterUriProviderRegistration: IJupyterServerProviderRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IInterpreterService) @optional() private readonly interpreterService: IInterpreterService | undefined
    ) {}
    private handledErrors = new WeakSet<Error>();
    private handledKernelErrors = new WeakSet<Error>();
    public async handleError(err: Error): Promise<void> {
        logger.warn('DataScience Error', err);
        err = WrappedError.unwrap(err);
        if (this.handledErrors.has(err)) {
            return;
        }
        this.handledErrors.add(err);
        if (err instanceof JupyterInstallError) {
            await this.dependencyManager?.installMissingDependencies(err);
        } else if (err instanceof JupyterSelfCertsError) {
            await handleSelfCertsError(this.configuration, err.message);
        } else if (err instanceof JupyterExpiredCertsError) {
            await handleExpiredCertsError(this.configuration, err.message);
        } else if (isCancellationError(err)) {
            // Don't show the message for cancellation errors
        } else if (err instanceof KernelConnectionTimeoutError || err instanceof KernelPortNotUsedTimeoutError) {
            window.showErrorMessage(err.message).then(noop, noop);
        } else if (
            err instanceof KernelDiedError ||
            err instanceof KernelProcessExitedError ||
            err instanceof JupyterNotebookNotInstalled ||
            err instanceof JupyterConnectError
        ) {
            window.showErrorMessage(getUserFriendlyErrorMessage(err)).then(noop, noop);
        } else if (err instanceof RemoteJupyterServerConnectionError && isWebExtension()) {
            // Special case for a failure on web
            window.showErrorMessage(DataScience.jupyterNotebookRemoteConnectFailedWeb(err.baseUrl)).then(noop, noop);
        } else if (err instanceof RemoteJupyterServerConnectionError) {
            const message = await this.handleJupyterServerConnectionError(err, undefined);
            window.showErrorMessage(message).then(noop, noop);
        } else if (err instanceof RemoteJupyterServerUriProviderError) {
            const message = await this.handleJupyterServerUriProviderError(err, undefined);
            window.showErrorMessage(message).then(noop, noop);
        } else {
            // Some errors have localized and/or formatted error messages.
            const message = getCombinedErrorMessage(err.message || err.toString());
            window.showErrorMessage(message).then(noop, noop);
        }
    }
    public async getErrorMessageForDisplayInCell(error: Error, errorContext: KernelAction, resource: Resource) {
        error = WrappedError.unwrap(error);
        if (!isCancellationError(error)) {
            logger.error(`Error in execution (get message for cell)`, error);
        }
        if (error instanceof KernelDeadError) {
            // When we get this we've already asked the user to restart the kernel,
            // No need to display errors in each cell.
            return '';
        } else if (error instanceof JupyterKernelDependencyError) {
            return getIPyKernelMissingErrorMessageForCell(error.kernelConnectionMetadata) || error.message;
        } else if (error instanceof JupyterInstallError) {
            return getJupyterMissingErrorMessageForCell(error) || error.message;
        } else if (error instanceof RemoteJupyterServerConnectionError && !isWebExtension()) {
            return error.message;
        } else if (error instanceof RemoteJupyterServerConnectionError && isWebExtension()) {
            return DataScience.jupyterNotebookRemoteConnectFailedWeb(error.baseUrl);
        } else if (isCancellationError(error)) {
            // Don't show the message for cancellation errors
            return '';
        } else if (error instanceof PackageNotInstalledWindowsLongPathNotEnabledError) {
            const packageName =
                typeof error.product === 'string'
                    ? error.product
                    : ProductNames.get(error.product) || `${error.product}`;
            const interpreterDisplayName = getPythonEnvDisplayName(error.interpreter) || error.interpreter.id || '';
            const env = getCachedEnvironment(error.interpreter);
            const displayPath = getDisplayPath(env?.executable.uri);
            let displayName = interpreterDisplayName ? ` ${interpreterDisplayName} (${displayPath})` : displayPath;
            return DataScience.packageNotInstalledWindowsLongPathNotEnabledError(packageName, displayName);
        } else if (
            (error instanceof KernelDiedError || error instanceof KernelProcessExitedError) &&
            (error.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                error.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter') &&
            error.kernelConnectionMetadata.interpreter &&
            !(await this.fs.exists(error.kernelConnectionMetadata.interpreter.uri))
        ) {
            return DataScience.failedToStartKernelDueToMissingPythonEnv(
                getPythonEnvDisplayName(error.kernelConnectionMetadata.interpreter) ||
                    getPythonEnvironmentName(error.kernelConnectionMetadata.interpreter) ||
                    getDisplayPath(error.kernelConnectionMetadata.interpreter.uri)
            );
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
            const [files, sysPrefix] = await Promise.all([
                this.getFilesInWorkingDirectoryThatCouldPotentiallyOverridePythonModules(resource),
                getSysPrefix(error.kernelConnectionMetadata.interpreter)
            ]);
            const failureInfo = analyzeKernelErrors(
                workspace.workspaceFolders || [],
                error,
                getDisplayNameOrNameOfKernelConnection(error.kernelConnectionMetadata),
                sysPrefix,
                files.map((f) => f.uri)
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
                    messageParts.push(Common.clickHereForMoreInfoWithHtml(failureInfo.moreInfoLink));
                }
                if (
                    isLocalConnection(error.kernelConnectionMetadata) &&
                    failureInfo.reason === KernelFailureReason.moduleNotFoundFailure &&
                    !['ipykernel_launcher', 'ipykernel'].includes(failureInfo.moduleName)
                ) {
                    await this.addErrorMessageIfPythonArePossiblyOverridingPythonModules(messageParts, resource);
                }
                return messageParts.join('\n');
            }
        } else if (error instanceof RemoteJupyterServerConnectionError) {
            return this.handleJupyterServerConnectionError(error, errorContext);
        } else if (error instanceof RemoteJupyterServerUriProviderError) {
            return this.handleJupyterServerUriProviderError(error, errorContext);
        } else if (error instanceof InvalidRemoteJupyterServerUriHandleError) {
            const extensionName =
                extensions.getExtension(error.serverProviderHandle.extensionId)?.packageJSON.displayName ||
                error.serverProviderHandle.extensionId;
            return getUserFriendlyErrorMessage(
                DataScience.remoteJupyterServerProvidedBy3rdPartyExtensionNoLongerValid(extensionName),
                errorContext
            );
        }

        return getUserFriendlyErrorMessage(error, errorContext);
    }
    private async handleJupyterServerUriProviderError(
        error: RemoteJupyterServerUriProviderError,
        errorContext?: KernelAction
    ) {
        const serverName = await getJupyterDisplayName(error.serverProviderHandle, this.jupyterUriProviderRegistration);
        const message = error.originalError?.message || error.message;

        return getUserFriendlyErrorMessage(
            DataScience.remoteJupyterConnectionFailedWithServerWithError(serverName, message),
            errorContext
        );
    }
    private async handleJupyterServerConnectionError(
        error: RemoteJupyterServerConnectionError,
        errorContext?: KernelAction
    ) {
        const serverName = await getJupyterDisplayName(
            error.serverProviderHandle,
            this.jupyterUriProviderRegistration,
            error.baseUrl
        );
        const message = error.originalError.message || '';
        return getUserFriendlyErrorMessage(
            DataScience.remoteJupyterConnectionFailedWithServerWithError(serverName, message),
            errorContext
        );
    }
    private async handleJupyterServerProviderConnectionError(
        serverHandle: JupyterServerProviderHandle,
        collection: JupyterServerCollection
    ) {
        const token = new CancellationTokenSource();
        try {
            const servers = await Promise.resolve(collection.serverProvider.provideJupyterServers(token.token));
            if (!servers) {
                return true;
            }
            if (!servers.find((s) => s.id === serverHandle.handle)) {
                await this.serverUriStorage.remove(serverHandle).catch(noop);
            }
            return true;
        } catch (_ex) {
            return false;
        } finally {
            token.dispose();
        }
    }
    public async handleKernelError(
        err: Error,
        errorContext: KernelAction,
        kernelConnection: KernelConnectionMetadata,
        resource: Resource,
        actionSource: KernelActionSource
    ): Promise<KernelInterpreterDependencyResponse> {
        if (!isCancellationError(err)) {
            logger.warn(`Kernel Error, context = ${errorContext}`, err);
        }
        err = WrappedError.unwrap(err);

        // Jupyter kernels, non zmq actually do the dependency install themselves
        if (isCancellationError(err)) {
            this.sendKernelTelemetry(err, errorContext, resource, 'cancelled');
            return KernelInterpreterDependencyResponse.cancel;
        } else if (err instanceof JupyterKernelDependencyError) {
            logger.warn(`Jupyter Kernel Dependency Error, reason=${err.reason}`, err);
            this.sendKernelTelemetry(err, errorContext, resource, err.category);
            if (err.reason === KernelInterpreterDependencyResponse.uiHidden && this.kernelDependency) {
                // At this point we're handling the error, and if the error was initially swallowed due to
                // auto start (ui hidden), now we need to display the error to the user.
                const tokenSource = new CancellationTokenSource();
                try {
                    const cannotChangeKernels = actionSource === '3rdPartyExtension';
                    return this.kernelDependency.installMissingDependencies({
                        resource,
                        kernelConnection,
                        ui: new DisplayOptions(false),
                        token: tokenSource.token,
                        ignoreCache: true,
                        cannotChangeKernels
                    });
                } finally {
                    tokenSource.dispose();
                }
            } else {
                return err.reason;
            }
            // Use the kernel dependency service to first determine if this is because dependencies are missing or not
        } else if ((errorContext === 'start' || errorContext === 'restart') && err instanceof JupyterInstallError) {
            this.sendKernelTelemetry(err, errorContext, resource, err.category);
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
            this.sendKernelTelemetry(err, errorContext, resource, err.category);
            const message =
                err instanceof InvalidRemoteJupyterServerUriHandleError
                    ? ''
                    : err instanceof RemoteJupyterServerConnectionError
                    ? err.originalError.message || ''
                    : err.originalError?.message || err.message;

            const extensionId = err.serverProviderHandle.extensionId;
            const id = err.serverProviderHandle.id;
            const collection = this.jupyterUriProviderRegistration.jupyterCollections.find(
                (c) => c.extensionId === extensionId && c.id == id
            );
            if (
                !collection ||
                (await this.handleJupyterServerProviderConnectionError(err.serverProviderHandle, collection))
            ) {
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            }
            const baseUrl = err instanceof RemoteJupyterServerConnectionError ? err.baseUrl : '';
            const serverName = getJupyterDisplayName(
                err.serverProviderHandle,
                this.jupyterUriProviderRegistration,
                baseUrl
            );
            const extensionName =
                err instanceof InvalidRemoteJupyterServerUriHandleError
                    ? extensions.getExtension(err.serverProviderHandle.extensionId)?.packageJSON.displayName ||
                      err.serverProviderHandle.extensionId
                    : '';
            const options = actionSource === 'jupyterExtension' ? [DataScience.selectDifferentKernel] : [];

            const selection = await window.showErrorMessage(
                err instanceof InvalidRemoteJupyterServerUriHandleError
                    ? DataScience.remoteJupyterServerProvidedBy3rdPartyExtensionNoLongerValid(extensionName)
                    : DataScience.remoteJupyterConnectionFailedWithServer(serverName),
                { detail: message, modal: true },
                DataScience.removeRemoteJupyterConnectionButtonText,
                DataScience.changeRemoteJupyterConnectionButtonText,
                ...options
            );
            switch (selection) {
                case DataScience.removeRemoteJupyterConnectionButtonText: {
                    // Remove this uri if already found (going to add again with a new time)
                    await this.serverUriStorage.remove(err.serverProviderHandle).catch(noop);
                    // Wait until all of the remote controllers associated with this server have been removed.
                    return KernelInterpreterDependencyResponse.cancel;
                }
                case DataScience.changeRemoteJupyterConnectionButtonText: {
                    return KernelInterpreterDependencyResponse.cancel;
                }
                case DataScience.selectDifferentKernel: {
                    return KernelInterpreterDependencyResponse.selectDifferentKernel;
                }
            }
            return KernelInterpreterDependencyResponse.cancel;
        } else if (err instanceof JupyterSelfCertsError) {
            this.sendKernelTelemetry(err, errorContext, resource, err.category);
            // On a self cert error, warn the user and ask if they want to change the setting
            const enableOption: string = DataScience.jupyterSelfCertEnable;
            const closeOption: string = DataScience.jupyterSelfCertClose;
            window
                .showErrorMessage(DataScience.jupyterSelfCertFail(err.message), enableOption, closeOption)
                .then((value) => {
                    if (value === enableOption) {
                        sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
                        this.configuration
                            .updateSetting(
                                'allowUnauthorizedRemoteConnection',
                                true,
                                undefined,
                                ConfigurationTarget.Workspace
                            )
                            .catch(noop);
                    } else if (value === closeOption) {
                        sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
                    }
                })
                .then(noop, noop);
            return KernelInterpreterDependencyResponse.failed;
        } else if (
            (errorContext === 'start' || errorContext === 'restart') &&
            kernelConnection.kind === 'startUsingPythonInterpreter' &&
            this.interpreterService &&
            !(await this.fs.exists(kernelConnection.interpreter.uri))
        ) {
            this.sendKernelTelemetry(err, errorContext, resource, KernelFailureReason.pythonEnvironmentMissing);
            window
                .showErrorMessage(
                    DataScience.failedToStartKernelDueToMissingPythonEnv(
                        getPythonEnvDisplayName(kernelConnection.interpreter) ||
                            getPythonEnvironmentName(kernelConnection.interpreter) ||
                            getDisplayPath(kernelConnection.interpreter.uri)
                    )
                )
                .then(noop, noop);
            this.interpreterService.refreshInterpreters(true).catch(noop);
            return KernelInterpreterDependencyResponse.failed;
        } else if (
            (errorContext === 'start' || errorContext === 'restart') &&
            this.kernelDependency &&
            !(await this.kernelDependency.areDependenciesInstalled(kernelConnection, undefined, true))
        ) {
            this.sendKernelTelemetry(err, errorContext, resource, 'noipykernel');
            const tokenSource = new CancellationTokenSource();
            try {
                const cannotChangeKernels = actionSource === '3rdPartyExtension';
                return this.kernelDependency.installMissingDependencies({
                    resource,
                    kernelConnection,
                    ui: new DisplayOptions(false),
                    token: tokenSource.token,
                    ignoreCache: true,
                    cannotChangeKernels
                });
            } finally {
                tokenSource.dispose();
            }
        } else {
            const [files, sysPrefix] = await Promise.all([
                this.getFilesInWorkingDirectoryThatCouldPotentiallyOverridePythonModules(resource),
                getSysPrefix(kernelConnection.interpreter)
            ]);

            const failureInfo = analyzeKernelErrors(
                workspace.workspaceFolders || [],
                err,
                getDisplayNameOrNameOfKernelConnection(kernelConnection),
                sysPrefix,
                files.map((f) => f.uri)
            );
            this.sendKernelTelemetry(err, errorContext, resource, failureInfo?.reason);
            if (failureInfo) {
                this.showMessageWithMoreInfo(failureInfo.message, failureInfo?.moreInfoLink).catch(noop);
            } else {
                // These are generic errors, we have no idea what went wrong,
                // hence add a descriptive prefix (message), that provides more context to the user.
                this.showMessageWithMoreInfo(getUserFriendlyErrorMessage(err, errorContext)).catch(noop);
            }
            return KernelInterpreterDependencyResponse.failed;
        }
    }
    private sendKernelTelemetry(
        err: Error,
        errorContext: KernelAction,
        resource: Resource,
        failureCategory: ErrorCategory | KernelFailureReason | undefined
    ) {
        if (this.handledKernelErrors.has(err)) {
            return;
        }
        this.handledKernelErrors.add(err);
        if (errorContext === 'start') {
            sendKernelTelemetryEvent(
                resource,
                Telemetry.NotebookStart,
                undefined,
                {
                    disableUI: false,
                    failureCategory
                },
                err
            );
        }
    }
    protected abstract addErrorMessageIfPythonArePossiblyOverridingPythonModules(
        _messages: string[],
        _resource: Resource
    ): Promise<void>;
    protected abstract getFilesInWorkingDirectoryThatCouldPotentiallyOverridePythonModules(
        _resource: Resource
    ): Promise<{ uri: Uri; type: 'file' | '__init__' }[]>;

    private async showMessageWithMoreInfo(message: string, moreInfoLink?: string) {
        if (!message.includes(Commands.ViewJupyterOutput)) {
            message = `${message} \n${DataScience.viewJupyterLogForFurtherInfo}`;
        }
        const buttons = moreInfoLink ? [Common.learnMore] : [];
        await window.showErrorMessage(message, ...buttons).then((selection) => {
            if (selection === Common.learnMore && moreInfoLink) {
                void env.openExternal(Uri.parse(moreInfoLink));
            }
        });
    }
}
const errorPrefixes = {
    restart: DataScience.failedToRestartKernel,
    start: DataScience.failedToStartKernel,
    interrupt: DataScience.failedToInterruptKernel,
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
    let errorMessageSuffix = '';
    if (error instanceof JupyterNotebookNotInstalled) {
        errorMessageSuffix = DataScience.jupyterNotebookNotInstalledOrNotFound(error.interpreter);
    } else if (error instanceof BaseError) {
        // These are generic errors, we have no idea what went wrong,
        // hence add a descriptive prefix (message), that provides more context to the user.
        errorMessageSuffix = getErrorMessageFromPythonTraceback(error.stdErr) || error.stdErr || error.message;
    } else {
        // These are generic errors, we have no idea what went wrong,
        // hence add a descriptive prefix (message), that provides more context to the user.
        errorMessageSuffix = typeof error === 'string' ? error : error.message;
    }
    return getCombinedErrorMessage(errorPrefix, errorMessageSuffix);
}
function doesErrorHaveMarkdownLinks(message: string) {
    const markdownLinks = new RegExp(/\[([^\[]+)\]\((.*)\)/);
    return (markdownLinks.exec(message)?.length ?? 0) > 0;
}
function getCombinedErrorMessage(prefix: string = '', message: string = '') {
    // No point in repeating the same message twice.
    // (strip the last character, as it could be a period).
    if (prefix && message.startsWith(prefix.substring(0, prefix.length - 1))) {
        prefix = '';
    }
    const errorMessage = [prefix, message]
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(' \n');

    if (
        !doesErrorHaveMarkdownLinks(errorMessage) &&
        errorMessage.length &&
        errorMessage.indexOf('command:jupyter.viewOutput') === -1
    ) {
        return `${errorMessage.endsWith('.') ? errorMessage : errorMessage + '.'} \n${
            DataScience.viewJupyterLogForFurtherInfo
        }`;
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
        getPythonEnvDisplayName(kernelConnection.interpreter) || getFilePath(kernelConnection.interpreter.uri);
    const ipyKernelName = ProductNames.get(Product.ipykernel)!;
    const ipyKernelModuleName = translateProductToModule(Product.ipykernel);

    let installerCommand = `${fileToCommandArgument(
        getFilePath(kernelConnection.interpreter.uri)
    )} -m pip install ${ipyKernelModuleName} -U --force-reinstall`;
    if (kernelConnection.interpreter && getEnvironmentType(kernelConnection.interpreter) === EnvironmentType.Conda) {
        const env = getCachedEnvironment(kernelConnection.interpreter);
        if (env?.environment?.name) {
            installerCommand = `conda install -n ${env?.environment?.name} ${ipyKernelModuleName} --update-deps --force-reinstall`;
        } else if (env?.environment?.folderUri) {
            installerCommand = `conda install -p ${getFilePath(
                env?.environment?.folderUri
            )} ${ipyKernelModuleName} --update-deps --force-reinstall`;
        }
    } else if (
        kernelConnection.interpreter &&
        getEnvironmentType(kernelConnection.interpreter) === EnvironmentType.Unknown
    ) {
        installerCommand = `${fileToCommandArgument(
            getFilePath(kernelConnection.interpreter.uri)
        )} -m pip install ${ipyKernelModuleName} -U --user --force-reinstall`;
    }
    const message = DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter(
        displayNameOfKernel,
        ProductNames.get(Product.ipykernel)!
    );
    const installationInstructions = DataScience.installPackageInstructions(ipyKernelName, installerCommand);
    return message + '\n' + installationInstructions;
}
function getJupyterMissingErrorMessageForCell(err: JupyterInstallError) {
    const productNames = `${ProductNames.get(Product.jupyter)} ${Common.and} ${ProductNames.get(Product.notebook)}`;
    const moduleNames = [Product.jupyter, Product.notebook].map(translateProductToModule).join(' ');

    const installerCommand = `python -m pip install ${moduleNames} -U\nor\nconda install ${moduleNames} -U`;
    const installationInstructions = DataScience.installPackageInstructions(productNames, installerCommand);

    return (
        err.message +
        '\n' +
        installationInstructions +
        '\n' +
        Common.clickHereForMoreInfoWithHtml('https://aka.ms/installJupyterForVSCode')
    );
}
