// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { WrappedError } from '../../common/errors/types';
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
import { CancellationError as VscCancellationError, CancellationTokenSource, ConfigurationTarget } from 'vscode';
import { CancellationError } from '../../common/cancellation';
import { KernelConnectionTimeoutError } from './kernelConnectionTimeoutError';
import { KernelDiedError } from './kernelDiedError';
import { KernelPortNotUsedTimeoutError } from './kernelPortNotUsedTimeoutError';
import { KernelProcessExitedError } from './kernelProcessExitedError';
import { PythonKernelDiedError } from './pythonKernelDiedError';
import {
    analyzeKernelErrors,
    getErrorMessageFromPythonTraceback,
    KernelFailureReason
} from '../../common/errors/errorUtils';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { IBrowserService, IConfigurationService, Resource } from '../../common/types';
import { Commands, Telemetry } from '../constants';
import { sendTelemetryEvent } from '../../telemetry';
import { DisplayOptions } from '../displayOptions';
import { JupyterConnectError } from './jupyterConnectError';

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
            err instanceof PythonKernelDiedError ||
            err instanceof JupyterConnectError
        ) {
            const defaultErrorMessage = getCombinedErrorMessage(
                // PythonKernelDiedError has an `errorMessage` property, use that over `err.stdErr` for user facing error messages.
                'errorMessage' in err ? err.errorMessage : getErrorMessageFromPythonTraceback(err.stdErr) || err.stdErr
            );
            this.applicationShell.showErrorMessage(defaultErrorMessage).then(noop, noop);
        } else {
            // Some errors have localized and/or formatted error messages.
            const message = getCombinedErrorMessage(err.message || err.toString());
            this.applicationShell.showErrorMessage(message).then(noop, noop);
        }
    }

    public async handleKernelError(
        err: Error,
        purpose: 'start' | 'restart' | 'interrupt' | 'execution',
        kernelConnection: KernelConnectionMetadata,
        resource: Resource
    ): Promise<KernelInterpreterDependencyResponse> {
        traceWarning('Kernel Error', err);
        err = WrappedError.unwrap(err);
        const failureInfo = analyzeKernelErrors(
            this.workspaceService.workspaceFolders || [],
            err,
            getDisplayNameOrNameOfKernelConnection(kernelConnection),
            kernelConnection.interpreter?.sysPrefix
        );
        if (failureInfo) {
            switch (failureInfo?.reason) {
                case KernelFailureReason.moduleNotFoundFailure: {
                    if (
                        failureInfo?.moduleName.toLowerCase().includes('ipykernel') &&
                        kernelConnection.interpreter &&
                        (purpose === 'start' || purpose === 'restart')
                    ) {
                        const token = new CancellationTokenSource();
                        return this.kernelDependency.installMissingDependencies(
                            resource,
                            kernelConnection,
                            new DisplayOptions(false),
                            token.token,
                            true
                        );
                    }
                    break;
                }
                default:
                    void this.showMessageWithMoreInfo(failureInfo?.message, failureInfo?.moreInfoLink);
                    break;
            }
        }
        return KernelInterpreterDependencyResponse.failed;
    }
    private async showMessageWithMoreInfo(message: string, moreInfoLink: string | undefined) {
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
