// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { IApplicationShell } from '../../common/application/types';
import { BaseError, WrappedError } from '../../common/errors/types';
import { traceError } from '../../common/logger';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { JupyterInstallError } from '../jupyter/jupyterInstallError';
import { JupyterSelfCertsError } from '../jupyter/jupyterSelfCertsError';
import { JupyterZMQBinariesNotFoundError } from '../jupyter/jupyterZMQBinariesNotFoundError';
import { JupyterServerSelector } from '../jupyter/serverSelector';
import { IpyKernelNotInstalledError } from '../kernel-launcher/types';
import { IDataScienceErrorHandler, IJupyterInterpreterDependencyManager } from '../types';
@injectable()
export class DataScienceErrorHandler implements IDataScienceErrorHandler {
    constructor(
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager) protected dependencyManager: IJupyterInterpreterDependencyManager,
        @inject(JupyterServerSelector) private serverSelector: JupyterServerSelector
    ) {}

    public async handleError(err: Error): Promise<void> {
        // Unwrap the errors.
        if (err instanceof WrappedError && err.originalException && err.originalException instanceof BaseError) {
            err = err.originalException;
        }
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
            this.applicationShell.showErrorMessage(err.message).then(noop, noop);
        } else {
            this.applicationShell.showErrorMessage(err.toString()).then(noop, noop);
        }
        traceError('DataScience Error', err);
    }

    private async showZMQError(err: JupyterZMQBinariesNotFoundError) {
        // Ask the user to always pick remote as this is their only option
        const selectNewServer = localize.DataScience.selectNewServer();
        this.applicationShell
            .showErrorMessage(localize.DataScience.nativeDependencyFail().format(err.toString()), selectNewServer)
            .then((selection) => {
                if (selection === selectNewServer) {
                    this.serverSelector.selectJupyterURI(false).ignoreErrors();
                }
            }, noop);
    }
}
