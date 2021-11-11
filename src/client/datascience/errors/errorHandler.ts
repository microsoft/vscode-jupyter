// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../../common/application/types';
import { BaseError, WrappedError } from '../../common/errors/types';
import { traceError, traceWarning } from '../../common/logger';
import { Common, DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { IpyKernelNotInstalledError } from './ipyKernelNotInstalledError';
import { JupyterInstallError } from './jupyterInstallError';
import { JupyterSelfCertsError } from './jupyterSelfCertsError';
import { getLanguageInNotebookMetadata } from '../jupyter/kernels/helpers';
import { isPythonNotebook } from '../notebook/helpers/helpers';
import { IDataScienceErrorHandler, IJupyterInterpreterDependencyManager } from '../types';
import { CancellationError as VscCancellationError } from 'vscode';
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
import { getDisplayPath } from '../../common/platform/fs-paths';
import { IBrowserService } from '../../common/types';

@injectable()
export class DataScienceErrorHandler implements IDataScienceErrorHandler {
    constructor(
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager) protected dependencyManager: IJupyterInterpreterDependencyManager,
        @inject(IWorkspaceService) protected workspace: IWorkspaceService,
        @inject(IBrowserService) protected browser: IBrowserService,
        @inject(ICommandManager) protected commandManager: ICommandManager
    ) {}
    public async handleError(err: Error): Promise<void> {
        traceError('DataScience Error', err);
        await this.handleErrorImplementation(err);
    }

    public async handleKernelError(
        err: Error,
        purpose: 'start' | 'restart' | 'interrupt' | 'execution',
        kernelConnection: KernelConnectionMetadata
    ): Promise<void> {
        await this.handleErrorImplementation(err, purpose, async (error: BaseError, defaultErrorMessage: string) => {
            const failureInfo = analyzeKernelErrors(
                error.stdErr || '',
                this.workspace.workspaceFolders,
                kernelConnection.interpreter?.sysPrefix
            );
            switch (failureInfo?.reason) {
                case KernelFailureReason.overridingBuiltinModules: {
                    await this.applicationShell
                        .showErrorMessage(
                            `${DataScience.fileSeemsToBeInterferingWithKernelStartup().format(
                                getDisplayPath(failureInfo.fileName, this.workspace.workspaceFolders || [])
                            )} \n${DataScience.viewJupyterLogForFurtherInfo()}`,
                            Common.learnMore()
                        )
                        .then((selection) => {
                            if (selection === Common.learnMore()) {
                                this.browser.launch('https://aka.ms/kernelFailuresOverridingBuiltInModules');
                            }
                        });
                    break;
                }
                default:
                    await this.applicationShell.showErrorMessage(defaultErrorMessage);
            }
        });
    }
    private async handleErrorImplementation(
        err: Error,
        purpose?: 'start' | 'restart' | 'interrupt' | 'execution',
        handler?: (error: BaseError, defaultErrorMessage: string) => Promise<void>
    ): Promise<void> {
        const errorPrefix = getErrorMessagePrefix(purpose);
        // Unwrap the errors.
        err = WrappedError.unwrap(err);
        if (err instanceof JupyterInstallError) {
            await this.dependencyManager.installMissingDependencies(err);
        } else if (err instanceof JupyterSelfCertsError) {
            // Don't show the message for self cert errors
            noop();
        } else if (err instanceof IpyKernelNotInstalledError) {
            // Don't show the message, as user decided not to install IPyKernel.
            noop();
        } else if (err instanceof VscCancellationError || err instanceof CancellationError) {
            // Don't show the message for cancellation errors
            traceWarning(`Cancelled by user`, err);
        } else if (err instanceof KernelConnectionTimeoutError || err instanceof KernelPortNotUsedTimeoutError) {
            this.applicationShell.showErrorMessage(err.message).then(noop, noop);
        } else if (
            err instanceof KernelDiedError ||
            err instanceof KernelProcessExitedError ||
            err instanceof PythonKernelDiedError
        ) {
            const defaultErrorMessage = getCombinedErrorMessage(
                errorPrefix,
                // PythonKernelDiedError has an `errorMessage` property, use that over `err.stdErr` for user facing error messages.
                'errorMessage' in err ? err.errorMessage : getErrorMessageFromPythonTraceback(err.stdErr) || err.stdErr
            );
            if ((purpose === 'restart' || purpose === 'start') && handler) {
                await handler(err, defaultErrorMessage);
            } else {
                this.applicationShell.showErrorMessage(defaultErrorMessage).then(noop, noop);
            }
        } else {
            // Some errors have localized and/or formatted error messages.
            this.applicationShell
                .showErrorMessage(getCombinedErrorMessage(errorPrefix, err.message || err.toString()))
                .then(noop, noop);
        }
        traceError('DataScience Error', err);
    }
}
function getCombinedErrorMessage(prefix?: string, message?: string) {
    const errorMessage = [prefix || '', message || '']
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(' \n');
    if (errorMessage.length && errorMessage.indexOf('command:jupyter.viewOutput') === -1) {
        return `${errorMessage}. \n${DataScience.viewJupyterLogForFurtherInfo()}`;
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
