// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import { IApplicationShell } from '../../common/application/types';
import { BaseError, WrappedError } from '../../common/errors/types';
import { traceError } from '../../common/logger';
import { IConfigurationService } from '../../common/types';
import { Common, DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { IServiceContainer } from '../../ioc/types';
import { sendTelemetryEvent } from '../../telemetry';
import { getTelemetrySafeLanguage } from '../../telemetry/helpers';
import { Telemetry } from '../constants';
import { JupyterInstallError } from '../jupyter/jupyterInstallError';
import { JupyterSelfCertsError } from '../jupyter/jupyterSelfCertsError';
import { JupyterZMQBinariesNotFoundError } from '../jupyter/jupyterZMQBinariesNotFoundError';
import { getLanguageInNotebookMetadata, isLocalLaunch } from '../jupyter/kernels/helpers';
import { JupyterServerSelector } from '../jupyter/serverSelector';
import { ILocalKernelFinder, IpyKernelNotInstalledError } from '../kernel-launcher/types';
import { isPythonNotebook } from '../notebook/helpers/helpers';
import { KernelSpecNotFoundError } from '../raw-kernel/liveshare/kernelSpecNotFoundError';
import { IDataScienceErrorHandler, IJupyterInterpreterDependencyManager } from '../types';
@injectable()
export class DataScienceErrorHandler implements IDataScienceErrorHandler {
    constructor(
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IJupyterInterpreterDependencyManager) protected dependencyManager: IJupyterInterpreterDependencyManager,
        @inject(JupyterServerSelector) private serverSelector: JupyterServerSelector,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer
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
        } else if (
            err instanceof KernelSpecNotFoundError &&
            isLocalLaunch(this.serviceContainer.get<IConfigurationService>(IConfigurationService)) &&
            (await this.doesNotHaveAnyKernel())
        ) {
            const language = getLanguageInNotebookMetadata(err.notebookMetadata);
            if (isPythonNotebook(err.notebookMetadata) || !language) {
                // If we know its a python notebook or there's no language in the metadata, then assume its a Python notebook.
                sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'displayed' });
                this.applicationShell
                    .showErrorMessage(DataScience.pythonNotInstalled(), Common.download())
                    .then((selection) => {
                        if (selection === Common.download()) {
                            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
                            this.applicationShell.openUrl('https://www.python.org/downloads');
                        } else {
                            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
                        }
                    }, noop);
            } else {
                sendTelemetryEvent(Telemetry.KernelNotInstalled, undefined, {
                    action: 'displayed',
                    language: getTelemetrySafeLanguage(language)
                });
                const kernelName =
                    err.notebookMetadata?.kernelspec?.display_name ||
                    err.notebookMetadata?.kernelspec?.name ||
                    language;
                this.applicationShell
                    .showErrorMessage(DataScience.kernelNotInstalled().format(kernelName))
                    .then(noop, noop);
            }
        } else if (err.message) {
            this.applicationShell.showErrorMessage(err.message).then(noop, noop);
        } else {
            this.applicationShell.showErrorMessage(err.toString()).then(noop, noop);
        }
        traceError('DataScience Error', err);
    }
    private async doesNotHaveAnyKernel() {
        const kernelFinder = this.serviceContainer.get<ILocalKernelFinder>(ILocalKernelFinder);
        const kernels = await kernelFinder.listKernels(undefined).catch(() => []);
        return kernels.length === 0;
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
