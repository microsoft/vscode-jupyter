// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { IApplicationShell } from '../../common/application/types';
import { BaseError, WrappedError } from '../../common/errors/types';
import { traceError } from '../../common/logger';
import { DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { JupyterInstallError } from '../jupyter/jupyterInstallError';
import { JupyterSelfCertsError } from '../jupyter/jupyterSelfCertsError';
import { JupyterZMQBinariesNotFoundError } from '../jupyter/jupyterZMQBinariesNotFoundError';
import { getLanguageInNotebookMetadata } from '../jupyter/kernels/helpers';
import { JupyterServerSelector } from '../jupyter/serverSelector';
import { IpyKernelNotInstalledError } from '../kernel-launcher/types';
import { isPythonNotebook } from '../notebook/helpers/helpers';
import { IDataScienceErrorHandler, IJupyterInterpreterDependencyManager } from '../types';
@injectable()
export class DataScienceErrorHandler implements IDataScienceErrorHandler {
    constructor(
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager) protected dependencyManager: IJupyterInterpreterDependencyManager,
        @inject(JupyterServerSelector) private serverSelector: JupyterServerSelector
    ) {}
    public static getBaseError(err: Error): Error {
        if (err instanceof WrappedError && err.originalException && err.originalException instanceof BaseError) {
            err = err.originalException;
        }
        return err;
    }
    public async handleError(err: Error): Promise<void> {
        // Unwrap the errors.
        err = WrappedError.unwrap(err);
        if (err instanceof JupyterInstallError) {
            await this.dependencyManager.installMissingDependencies(err);
        } else if (err instanceof JupyterZMQBinariesNotFoundError) {
            await this.showZMQError(err);
        } else if (err instanceof JupyterSelfCertsError) {
            // Don't show the message for self cert errors
            noop();
        } else if (err instanceof IpyKernelNotInstalledError) {
            // Don't show the message, as user decided not to install IPyKernel.
            noop();
        } else if (err.message) {
            // Some errors have localized and/or formatted error messages.
            this.applicationShell.showErrorMessage(err.message).then(noop, noop);
        } else {
            this.applicationShell.showErrorMessage(err.toString()).then(noop, noop);
        }
        traceError('DataScience Error', err);
    }
    private async showZMQError(err: JupyterZMQBinariesNotFoundError) {
        // Ask the user to always pick remote as this is their only option
        const selectNewServer = DataScience.selectNewServer();
        this.applicationShell
            .showErrorMessage(DataScience.nativeDependencyFail().format(err.toString()), selectNewServer)
            .then((selection) => {
                if (selection === selectNewServer) {
                    this.serverSelector.selectJupyterURI(false).ignoreErrors();
                }
            }, noop);
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
