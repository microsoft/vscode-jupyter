// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { BaseError, WrappedError } from '../../common/errors/types';
import { traceError, traceWarning } from '../../common/logger';
import { DataScience } from '../../common/utils/localize';
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
import { analyseKernelErrors, getErrorMessageFromPythonTraceback } from '../../common/errors/errorUtils';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';

@injectable()
export class DataScienceErrorHandler implements IDataScienceErrorHandler {
    constructor(
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager) protected dependencyManager: IJupyterInterpreterDependencyManager,
        @inject(IWorkspaceService) protected workspace: IWorkspaceService
    ) {}
    public async handleError(err: Error, purpose?: 'start' | 'restart' | 'interrupt'): Promise<void> {
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
        } else if (
            err instanceof KernelConnectionTimeoutError ||
            err instanceof KernelConnectionTimeoutError ||
            err instanceof KernelPortNotUsedTimeoutError
        ) {
            this.applicationShell.showErrorMessage(err.message).then(noop, noop);
        } else if (err instanceof KernelDiedError || err instanceof KernelProcessExitedError) {
            if (purpose === 'restart' || purpose === 'start') {
                const analysis = analyseKernelErrors(err.stdErr);
                console.error(analysis);
            }
            this.applicationShell
                .showErrorMessage(
                    getCombinedErrorMessage(errorPrefix, getErrorMessageFromPythonTraceback(err.stdErr) || err.stdErr)
                )
                .then(noop, noop);
        } else if (err instanceof PythonKernelDiedError) {
            this.applicationShell
                .showErrorMessage(getCombinedErrorMessage(errorPrefix, err.errorMessage))
                .then(noop, noop);
        } else {
            // Some errors have localized and/or formatted error messages.
            this.applicationShell
                .showErrorMessage(getCombinedErrorMessage(errorPrefix, err.message || err.toString()))
                .then(noop, noop);
        }
        traceError('DataScience Error', err);
    }

    public async handleKernelStartRestartError(
        err: Error,
        purpose: 'start' | 'restart',
        kernelConnection: KernelConnectionMetadata
    ): Promise<void> {
        await this.handleErrorImplementation(err, purpose, (error: BaseError) => {
            const analysis = analyseKernelErrors(
                error.stdErr || '',
                this.workspace.workspaceFolders,
                kernelConnection.interpreter?.sysPrefix
            );
            if (analysis) {
                console.log(analysis);
            } else {
                const errorPrefix = getErrorMessagePrefix(purpose);
                void this.applicationShell
                    .showErrorMessage(
                        getCombinedErrorMessage(
                            errorPrefix,
                            getErrorMessageFromPythonTraceback(error.stdErr) || error.stdErr
                        )
                    )
                    .then(noop, noop);
            }
        });
    }
    private async handleErrorImplementation(
        err: Error,
        purpose?: 'start' | 'restart' | 'interrupt',
        handler?: (error: BaseError) => void
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
        } else if (
            err instanceof KernelConnectionTimeoutError ||
            err instanceof KernelConnectionTimeoutError ||
            err instanceof KernelPortNotUsedTimeoutError
        ) {
            this.applicationShell.showErrorMessage(err.message).then(noop, noop);
        } else if (err instanceof KernelDiedError || err instanceof KernelProcessExitedError) {
            if ((purpose === 'restart' || purpose === 'start') && handler) {
                handler(err);
            } else {
                this.applicationShell
                    .showErrorMessage(
                        getCombinedErrorMessage(
                            errorPrefix,
                            getErrorMessageFromPythonTraceback(err.stdErr) || err.stdErr
                        )
                    )
                    .then(noop, noop);
            }
        } else if (err instanceof PythonKernelDiedError) {
            this.applicationShell
                .showErrorMessage(getCombinedErrorMessage(errorPrefix, err.errorMessage))
                .then(noop, noop);
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
function getErrorMessagePrefix(purpose?: 'start' | 'restart' | 'interrupt') {
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
