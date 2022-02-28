// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable, named } from 'inversify';
import { IApplicationShell, ICommandManager, IVSCodeNotebook, IWorkspaceService } from '../../common/application/types';
import { BaseError, WrappedError } from '../../common/errors/types';
import { traceError, traceInfoIfCI, traceWarning } from '../../common/logger';
import { Common, DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { IpyKernelNotInstalledError } from './ipyKernelNotInstalledError';
import { JupyterInstallError } from './jupyterInstallError';
import { JupyterSelfCertsError } from './jupyterSelfCertsError';
import { getLanguageInNotebookMetadata, isPythonKernelConnection } from '../jupyter/kernels/helpers';
import { isPythonNotebook } from '../notebook/helpers/helpers';
import {
    IDataScienceErrorHandler,
    IInteractiveWindowProvider,
    IJupyterInterpreterDependencyManager,
    IKernelDependencyService,
    KernelInterpreterDependencyResponse
} from '../types';
import {
    CancellationError as VscCancellationError,
    CancellationTokenSource,
    ConfigurationTarget,
    EventEmitter,
    Memento,
    NotebookCell,
    NotebookCellOutput,
    NotebookCellOutputItem
} from 'vscode';
import { CancellationError } from '../../common/cancellation';
import { KernelConnectionTimeoutError } from './kernelConnectionTimeoutError';
import { KernelDiedError } from './kernelDiedError';
import { KernelPortNotUsedTimeoutError } from './kernelPortNotUsedTimeoutError';
import { KernelProcessExitedError } from './kernelProcessExitedError';
import { PythonKernelDiedError } from './pythonKernelDiedError';
import {
    analyzeKernelErrors,
    getErrorMessageFromPythonTraceback as getErrorMessageFromPythonTraceBack,
    KernelFailure,
    KernelFailureReason
} from '../../common/errors/errorUtils';
import { IKernelProvider, KernelConnectionMetadata } from '../jupyter/kernels/types';
import { getDisplayPath } from '../../common/platform/fs-paths';
import {
    GLOBAL_MEMENTO,
    IBrowserService,
    IConfigurationService,
    IMemento,
    Product,
    Resource
} from '../../common/types';
import { Commands, Telemetry } from '../constants';
import { sendTelemetryEvent } from '../../telemetry';
import { DisplayOptions } from '../displayOptions';
import { IServiceContainer } from '../../ioc/types';
import { StopWatch } from '../../common/utils/stopWatch';
import { sleep } from '../../common/utils/async';
import { INotebookControllerManager } from '../notebook/types';
import { JupyterConnectError } from './jupyterConnectError';
import { JupyterInterpreterService } from '../jupyter/interpreter/jupyterInterpreterService';
import { ProductNames } from '../../common/installer/productNames';
import { EnvironmentType } from '../../pythonEnvironments/info';
import { JupyterInterpreterDependencyResponse } from '../jupyter/interpreter/jupyterInterpreterDependencyService';
import {
    clearInstalledIntoInterpreterMemento,
    translateProductToModule
} from '../../common/installer/productInstaller';
import { JupyterInvalidKernelError } from './jupyterInvalidKernelError';
import { selectKernel } from '../jupyter/kernels/kernelSelector';

function getFirstCell(cells?: NotebookCell[]) {
    return cells?.length ? cells[0] : undefined;
}
@injectable()
export class DataScienceErrorHandler implements IDataScienceErrorHandler {
    private readonly _onShouldRunCells = new EventEmitter<NotebookCell[]>();
    public readonly onShouldRunCells = this._onShouldRunCells.event;
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager)
        private readonly dependencyManager: IJupyterInterpreterDependencyManager,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IBrowserService) private readonly browser: IBrowserService,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IKernelDependencyService) private readonly kernelDependency: IKernelDependencyService,
        @inject(JupyterInterpreterService) private readonly jupyterInterpreter: JupyterInterpreterService,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento
    ) {}
    public async handleError(err: Error): Promise<void> {
        traceWarning('DataScience Error', err);
        await this.handleErrorImplementation(err);
    }

    public async handleKernelError(
        err: Error,
        purpose: 'start' | 'restart' | 'interrupt' | 'execution',
        kernelConnection: KernelConnectionMetadata,
        resource: Resource,
        pendingCells?: NotebookCell[]
    ): Promise<void> {
        traceWarning('Kernel Error', err);
        if (kernelConnection.interpreter && purpose === 'start') {
            // If we failed to start the kernel, then clear cache used to track
            // whether we have dependencies installed or not.
            // Possible something is missing.
            void clearInstalledIntoInterpreterMemento(this.memento, undefined, kernelConnection.interpreter.path);
        }
        return this.handleErrorImplementation(
            err,
            purpose,
            kernelConnection,
            resource,
            pendingCells,
            async (error: BaseError, defaultErrorMessage?: string) => {
                const failureInfo = analyzeKernelErrors(
                    error.stdErr || '',
                    this.workspace.workspaceFolders,
                    kernelConnection.interpreter?.sysPrefix,
                    err instanceof JupyterConnectError
                );
                if (err instanceof IpyKernelNotInstalledError && (purpose === 'start' || purpose === 'restart')) {
                    void this.handleIPyKernelNotInstalledError(err, purpose, kernelConnection, resource, pendingCells);
                    return;
                } else if (err instanceof JupyterInstallError && (purpose === 'start' || purpose === 'restart')) {
                    void this.displayJupyterMissingErrorInCell(err, kernelConnection, getFirstCell(pendingCells));
                    return;
                } else if (err instanceof JupyterConnectError) {
                    void this.handleJupyterStartupError(failureInfo, err, kernelConnection, getFirstCell(pendingCells));
                    return;
                }

                switch (failureInfo?.reason) {
                    case KernelFailureReason.overridingBuiltinModules: {
                        await this.showMessageWithMoreInfo(
                            DataScience.fileSeemsToBeInterferingWithKernelStartup().format(
                                getDisplayPath(failureInfo.fileName, this.workspace.workspaceFolders || [])
                            ),
                            'https://aka.ms/kernelFailuresOverridingBuiltInModules',
                            getFirstCell(pendingCells)
                        );
                        break;
                    }
                    case KernelFailureReason.moduleNotFoundFailure: {
                        // if ipykernel or ipykernle_launcher is missing, then install it
                        // Provided we know for a fact that it is missing, else we could end up spamming the user unnecessarily.
                        if (
                            failureInfo.moduleName.toLowerCase().includes('ipykernel') &&
                            kernelConnection.interpreter &&
                            !(await this.kernelDependency.areDependenciesInstalled(kernelConnection, undefined, true))
                        ) {
                            const token = new CancellationTokenSource();
                            try {
                                await this.kernelDependency
                                    .installMissingDependencies(
                                        resource,
                                        kernelConnection,
                                        new DisplayOptions(false),
                                        token.token,
                                        true
                                    )
                                    .finally(() => token.dispose());
                            } catch (ex) {
                                // Handle instances where installation failed or or cancelled it.
                                if (ex instanceof IpyKernelNotInstalledError) {
                                    if (ex.selectAnotherKernel) {
                                        void this.displayKernelPickerAndReRunCells(
                                            kernelConnection,
                                            resource,
                                            pendingCells
                                        );
                                        return;
                                    }

                                    await this.displayIPyKernelMissingErrorInCell(
                                        kernelConnection,
                                        getFirstCell(pendingCells)
                                    );
                                } else {
                                    throw ex;
                                }
                            }
                        } else {
                            await this.showMessageWithMoreInfo(
                                DataScience.failedToStartKernelDueToMissingModule().format(failureInfo.moduleName),
                                'https://aka.ms/kernelFailuresMissingModule',
                                getFirstCell(pendingCells)
                            );
                        }
                        break;
                    }
                    case KernelFailureReason.importFailure: {
                        const fileName = failureInfo.fileName
                            ? getDisplayPath(failureInfo.fileName, this.workspace.workspaceFolders || [])
                            : '';
                        if (fileName) {
                            await this.showMessageWithMoreInfo(
                                DataScience.failedToStartKernelDueToImportFailureFromFile().format(
                                    failureInfo.moduleName,
                                    fileName
                                ),
                                'https://aka.ms/kernelFailuresModuleImportErrFromFile',
                                getFirstCell(pendingCells)
                            );
                        } else {
                            await this.showMessageWithMoreInfo(
                                DataScience.failedToStartKernelDueToImportFailure().format(failureInfo.moduleName),
                                'https://aka.ms/kernelFailuresModuleImportErr',
                                getFirstCell(pendingCells)
                            );
                        }
                        break;
                    }
                    case KernelFailureReason.dllLoadFailure: {
                        const message = failureInfo.moduleName
                            ? DataScience.failedToStartKernelDueToDllLoadFailure().format(failureInfo.moduleName)
                            : DataScience.failedToStartKernelDueToUnknowDllLoadFailure();
                        await this.showMessageWithMoreInfo(
                            message,
                            'https://aka.ms/kernelFailuresDllLoad',
                            getFirstCell(pendingCells)
                        );
                        break;
                    }
                    case KernelFailureReason.importWin32apiFailure: {
                        await this.showMessageWithMoreInfo(
                            DataScience.failedToStartKernelDueToWin32APIFailure(),
                            'https://aka.ms/kernelFailuresWin32Api',
                            getFirstCell(pendingCells)
                        );
                        break;
                    }
                    case KernelFailureReason.zmqModuleFailure: {
                        await this.showMessageWithMoreInfo(
                            DataScience.failedToStartKernelDueToPyZmqFailure(),
                            'https://aka.ms/kernelFailuresPyzmq',
                            getFirstCell(pendingCells)
                        );
                        break;
                    }
                    case KernelFailureReason.oldIPythonFailure: {
                        await this.showMessageWithMoreInfo(
                            DataScience.failedToStartKernelDueToOldIPython(),
                            'https://aka.ms/kernelFailuresOldIPython',
                            getFirstCell(pendingCells)
                        );
                        break;
                    }
                    case KernelFailureReason.oldIPyKernelFailure: {
                        await this.showMessageWithMoreInfo(
                            DataScience.failedToStartKernelDueToOldIPyKernel(),
                            'https://aka.ms/kernelFailuresOldIPyKernel',
                            getFirstCell(pendingCells)
                        );
                        break;
                    }
                    default:
                        if (defaultErrorMessage) {
                            void this.displayErrorsInCell(defaultErrorMessage, getFirstCell(pendingCells));
                            await this.applicationShell.showErrorMessage(defaultErrorMessage);
                        }
                }
            }
        );
    }
    private async handleIPyKernelNotInstalledError(
        err: Error,
        purpose?: 'start' | 'restart' | 'interrupt' | 'execution',
        kernelConnection?: KernelConnectionMetadata,
        resource?: Resource,
        pendingCells?: NotebookCell[]
    ) {
        if (!kernelConnection || !(err instanceof IpyKernelNotInstalledError)) {
            return;
        }
        if (purpose !== 'start' && purpose !== 'restart') {
            return;
        }
        if (err.reason === KernelInterpreterDependencyResponse.uiHidden && kernelConnection.interpreter) {
            if (err.selectAnotherKernel) {
                return this.displayKernelPickerAndReRunCells(kernelConnection, resource, pendingCells);
            }
            // Its possible auto start ran and UI was disabled, but subsequently
            // user attempted to run a cell, & the prompt wasn't displayed to the user.
            const token = new CancellationTokenSource();
            try {
                await this.kernelDependency
                    .installMissingDependencies(
                        resource,
                        kernelConnection,
                        new DisplayOptions(false),
                        token.token,
                        true
                    )
                    .finally(() => token.dispose());
            } catch (ex) {
                if (ex instanceof IpyKernelNotInstalledError) {
                    if (ex.selectAnotherKernel) {
                        return this.displayKernelPickerAndReRunCells(kernelConnection, resource, pendingCells);
                    } else {
                        return this.displayIPyKernelMissingErrorInCell(
                            kernelConnection,
                            pendingCells ? pendingCells[0] : undefined
                        );
                    }
                }
                traceError(`IPyKernel not installed`, ex);
            }
            return;
        } else if (purpose === 'start' || purpose === 'restart') {
            if (err.selectAnotherKernel) {
                return this.displayKernelPickerAndReRunCells(kernelConnection, resource, pendingCells);
            } else {
                return this.displayIPyKernelMissingErrorInCell(
                    kernelConnection,
                    pendingCells ? pendingCells[0] : undefined
                );
            }
        }
    }
    private async displayKernelPickerAndReRunCells(
        _kernelConnection: KernelConnectionMetadata,
        resource: Resource,
        pendingCells?: NotebookCell[]
    ) {
        traceInfoIfCI(`Display kernel picker to select a different kernel`);
        if (
            await selectKernel(
                resource,
                this.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook),
                this.serviceContainer.get<IInteractiveWindowProvider>(IInteractiveWindowProvider),
                this.serviceContainer.get<ICommandManager>(ICommandManager)
            )
        ) {
            if (!pendingCells || pendingCells.length === 0) {
                traceInfoIfCI(`No pending cells to trigger re-run of cells`);
                return;
            }
            traceInfoIfCI(`Triggering re-run of cells`);
            // Display kernel picker & then trigger an execution of the cells.
            this._onShouldRunCells.fire(Array.from(pendingCells || []));
        }
    }
    /**
     * Sometimes kernel execution fails as ipykernel or similar dependencies are not installed.
     * This could happen when we assume its installed (based on some previous cache) & then attempt to start.
     * E.g. user re-creates the virtual env, or re-installs python, in that case ipykernel is no longer available.
     *
     * In these cases, check if the dependencies are available or not, & if not, then prompt to install.
     * If packages are found, then return an lets process the errors as usual.
     */
    private async handlePossibleDependencyError(
        err: Error,
        defaultErrorMessage: string,
        kernelConnectionMetadata?: KernelConnectionMetadata,
        resource?: Resource,
        pendingCells?: NotebookCell[]
    ): Promise<undefined | 'ErrorsHandledAndAddressed'> {
        if (
            !(err instanceof JupyterInvalidKernelError) &&
            !(err instanceof KernelDiedError) &&
            !(err instanceof KernelProcessExitedError)
        ) {
            return;
        }
        if (!kernelConnectionMetadata || !isPythonKernelConnection(kernelConnectionMetadata)) {
            return;
        }
        if (err instanceof KernelDiedError && !err.message.includes('No module named ipykernel_launcher')) {
            return;
        }
        // Possible ipykernel or other such dependencies is no longer installed in the environment.
        // Look for the dependencies once again.
        const installed = await this.kernelDependency.areDependenciesInstalled(
            kernelConnectionMetadata,
            undefined,
            true
        );
        if (installed) {
            return;
        }
        const startupUi = new DisplayOptions(false);
        const token = new CancellationTokenSource();
        try {
            const response = await this.kernelDependency.installMissingDependencies(
                resource,
                kernelConnectionMetadata,
                startupUi,
                token.token,
                true
            );
            // If we have successfully installed, then re-run the cells.
            if (response === 'dependenciesInstalled' && pendingCells?.length) {
                // Re-run the cells as dependencies were installed.
                this._onShouldRunCells.fire(pendingCells);
            }
        } catch (ex) {
            traceError(`Missing dependencies not installed`, ex);
            const cellToDisplayErrors =
                Array.isArray(pendingCells) && pendingCells.length ? pendingCells[0] : undefined;
            if (ex instanceof IpyKernelNotInstalledError) {
                if (ex.selectAnotherKernel) {
                    void this.displayKernelPickerAndReRunCells(kernelConnectionMetadata, resource, pendingCells);
                    return;
                }
                void this.displayIPyKernelMissingErrorInCell(kernelConnectionMetadata, cellToDisplayErrors);
            } else {
                void this.displayErrorsInCell(defaultErrorMessage, cellToDisplayErrors);
                this.applicationShell.showErrorMessage(defaultErrorMessage).then(noop, noop);
            }
        }
        return 'ErrorsHandledAndAddressed';
    }
    private async showMessageWithMoreInfo(
        message: string,
        moreInfoLink: string | undefined,
        cellToDisplayErrors?: NotebookCell
    ) {
        if (!message.includes(Commands.ViewJupyterOutput)) {
            message = `${message} \n${DataScience.viewJupyterLogForFurtherInfo()}`;
        }
        void this.displayErrorsInCell(message, cellToDisplayErrors, moreInfoLink);
        const buttons = moreInfoLink ? [Common.learnMore()] : [];
        await this.applicationShell.showErrorMessage(message, ...buttons).then((selection) => {
            if (selection === Common.learnMore() && moreInfoLink) {
                this.browser.launch(moreInfoLink);
            }
        });
    }
    private async handleJupyterStartupError(
        failureInfo: KernelFailure | undefined,
        error: JupyterConnectError,
        kernelConnection: KernelConnectionMetadata,
        cellToDisplayErrors?: NotebookCell
    ) {
        const failureInfoFromMessage =
            failureInfo ||
            analyzeKernelErrors(
                error.message,
                this.workspace.workspaceFolders,
                kernelConnection.interpreter?.sysPrefix,
                true
            );
        // Extract the python error message so we can display that.
        let pythonError: string | undefined =
            failureInfoFromMessage?.reason === KernelFailureReason.jupyterStartFailure ||
            failureInfoFromMessage?.reason === KernelFailureReason.jupyterStartFailureOutdatedTraitlets
                ? failureInfoFromMessage?.errorMessage
                : undefined;
        if (!pythonError) {
            // Some times the error message is either in the message or the stderr.
            pythonError = error.message
                .splitLines({ removeEmptyEntries: true, trim: true })
                .reverse()
                .find((item) => item.toLowerCase().includes('Error: '));
            pythonError =
                pythonError ||
                (error.stdErr || '')
                    .splitLines({ removeEmptyEntries: true, trim: true })
                    .reverse()
                    .find((item) => item.toLowerCase().includes('Error: '));
        }
        const jupyterInterpreter = await this.jupyterInterpreter.getSelectedInterpreter();
        const envDisplayName = jupyterInterpreter
            ? `${jupyterInterpreter.displayName} (${getDisplayPath(
                  jupyterInterpreter.path,
                  this.workspace.workspaceFolders || []
              )})`
            : '';
        if (
            jupyterInterpreter &&
            failureInfoFromMessage?.reason === KernelFailureReason.jupyterStartFailureOutdatedTraitlets
        ) {
            void this.showMessageWithMoreInfo(
                DataScience.failedToStartJupyterDueToOutdatedTraitlets().format(envDisplayName, pythonError || ''),
                'https://aka.ms/kernelFailuresJupyterTrailtletsOutdated',
                cellToDisplayErrors
            );
        } else {
            const message = pythonError
                ? DataScience.failedToStartJupyterWithErrorInfo().format(envDisplayName, pythonError)
                : DataScience.failedToStartJupyter().format(envDisplayName);
            void this.showMessageWithMoreInfo(message, undefined, cellToDisplayErrors);
        }
    }
    private async handleErrorImplementation(
        err: Error,
        purpose?: 'start' | 'restart' | 'interrupt' | 'execution',
        kernelConnectionMetadata?: KernelConnectionMetadata,
        resource?: Resource,
        pendingCells?: NotebookCell[],
        handler?: (error: BaseError, defaultErrorMessage?: string) => Promise<void>
    ): Promise<void> {
        const errorPrefix = getErrorMessagePrefix(purpose);
        // Unwrap the errors.
        err = WrappedError.unwrap(err);
        if (err instanceof JupyterInstallError) {
            const result = await this.dependencyManager.installMissingDependencies(err);
            if (
                result === JupyterInterpreterDependencyResponse.cancel &&
                (purpose === 'start' || purpose === 'restart') &&
                handler
            ) {
                await handler(err);
            }
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
        } else if (err instanceof IpyKernelNotInstalledError) {
            void this.handleIPyKernelNotInstalledError(err, purpose, kernelConnectionMetadata, resource, pendingCells);
        } else if (err instanceof VscCancellationError || err instanceof CancellationError) {
            // Don't show the message for cancellation errors
            traceWarning(`Cancelled by user`, err);
        } else if (err instanceof KernelConnectionTimeoutError || err instanceof KernelPortNotUsedTimeoutError) {
            void this.displayErrorsInCell(err.message, getFirstCell(pendingCells));
            this.applicationShell.showErrorMessage(err.message).then(noop, noop);
        } else if (
            err instanceof KernelDiedError ||
            err instanceof KernelProcessExitedError ||
            err instanceof PythonKernelDiedError ||
            err instanceof JupyterConnectError
        ) {
            const defaultErrorMessage = getCombinedErrorMessage(
                errorPrefix,
                // PythonKernelDiedError has an `errorMessage` property, use that over `err.stdErr` for user facing error messages.
                'errorMessage' in err ? err.errorMessage : getErrorMessageFromPythonTraceBack(err.stdErr) || err.stdErr
            );
            const result = await this.handlePossibleDependencyError(
                err,
                defaultErrorMessage,
                kernelConnectionMetadata,
                resource,
                pendingCells
            );
            if (result === 'ErrorsHandledAndAddressed') {
                return;
            }
            if ((purpose === 'restart' || purpose === 'start') && handler) {
                await handler(err, defaultErrorMessage);
            } else {
                void this.displayErrorsInCell(defaultErrorMessage, getFirstCell(pendingCells));
                this.applicationShell.showErrorMessage(defaultErrorMessage).then(noop, noop);
            }
        } else {
            // Some errors have localized and/or formatted error messages.
            const message = getCombinedErrorMessage(errorPrefix, err.message || err.toString());
            const result = await this.handlePossibleDependencyError(
                err,
                message,
                kernelConnectionMetadata,
                resource,
                pendingCells
            );
            if (result === 'ErrorsHandledAndAddressed') {
                return;
            }
            void this.displayErrorsInCell(message, getFirstCell(pendingCells));
            this.applicationShell.showErrorMessage(message).then(noop, noop);
        }
    }
    private async displayIPyKernelMissingErrorInCell(
        kernelConnection: KernelConnectionMetadata,
        cellToDisplayErrors?: NotebookCell
    ) {
        if (!cellToDisplayErrors) {
            return;
        }
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
        const installationInstructions = DataScience.installPackageInstructions().format(
            ipyKernelName,
            installerCommand
        );
        await this.displayErrorsInCell(message + '\n' + installationInstructions, cellToDisplayErrors);
    }
    private async displayJupyterMissingErrorInCell(
        err: JupyterInstallError,
        kernelConnection: KernelConnectionMetadata,
        cellToDisplayErrors?: NotebookCell
    ) {
        if (!cellToDisplayErrors) {
            return;
        }
        if (
            kernelConnection.kind === 'connectToLiveKernel' ||
            kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
            !kernelConnection.interpreter
        ) {
            return;
        }
        const productNames = `${ProductNames.get(Product.jupyter)} ${Common.and()} ${ProductNames.get(
            Product.notebook
        )}`;
        const moduleNames = [Product.jupyter, Product.notebook].map(translateProductToModule).join(' ');

        let installerCommand = `${kernelConnection.interpreter.path.fileToCommandArgument()} -m pip install ${moduleNames} -U`;
        if (kernelConnection.interpreter?.envType === EnvironmentType.Conda) {
            if (kernelConnection.interpreter?.envName) {
                installerCommand = `conda install -n ${kernelConnection.interpreter?.envName} ${moduleNames}`;
            } else if (kernelConnection.interpreter?.envPath) {
                installerCommand = `conda install -p ${kernelConnection.interpreter?.envPath} ${moduleNames}`;
            }
        }
        const installationInstructions = DataScience.installPackageInstructions().format(
            productNames,
            installerCommand
        );
        await this.displayErrorsInCell(err.message + '\n' + installationInstructions, cellToDisplayErrors);
    }
    private async displayErrorsInCell(errorMessage: string, cellToDisplayErrors?: NotebookCell, moreInfoLink?: string) {
        if (!cellToDisplayErrors || !errorMessage) {
            return;
        }
        const associatedKernel = this.serviceContainer
            .get<IKernelProvider>(IKernelProvider)
            .get(cellToDisplayErrors.notebook);
        if (!associatedKernel) {
            return;
        }
        // Sometimes the cells are still running, wait for 1s for cells to finish & get cleared,
        // Then display the error in the cell.
        const stopWatch = new StopWatch();
        while (stopWatch.elapsedTime <= 1_000 && associatedKernel.pendingCells.length) {
            await sleep(100);
        }
        if (associatedKernel.pendingCells.length) {
            return;
        }
        const controllers = this.serviceContainer.get<INotebookControllerManager>(INotebookControllerManager);
        const controller = controllers.getSelectedNotebookController(cellToDisplayErrors.notebook);
        // Possible it changed.
        if (!controller || controller.connection !== associatedKernel.kernelConnectionMetadata) {
            return;
        }
        // If we have markdown links to run a command, turn that into a link.
        const regex = /\[(?<name>.*)\]\((?<command>command:\S*)\)/gm;
        let matches: RegExpExecArray | undefined | null;
        while ((matches = regex.exec(errorMessage)) !== null) {
            if (matches.length === 3) {
                errorMessage = errorMessage.replace(matches[0], `<a href='${matches[2]}'>${matches[1]}</a>`);
            }
        }
        if (moreInfoLink) {
            errorMessage += `\n<a href='${moreInfoLink}'>${Common.learnMore()}</a>`;
        }
        const execution = controller.controller.createNotebookCellExecution(cellToDisplayErrors);
        execution.start();
        void execution.clearOutput(cellToDisplayErrors);
        const output = new NotebookCellOutput([
            NotebookCellOutputItem.error({
                message: '',
                name: '',
                stack: `\u001b[1;31m${errorMessage.trim()}`
            })
        ]);
        void execution.appendOutput(output);
        execution.end(undefined);
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
function getErrorMessagePrefix(purpose?: 'start' | 'restart' | 'interrupt' | 'execution') {
    switch (purpose) {
        case 'restart':
            return DataScience.failedToRestartKernel();
        case 'start':
            return DataScience.failedToStartKernel();
        case 'interrupt':
            return DataScience.failedToInterruptKernel();
        default:
            return '';
    }
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
