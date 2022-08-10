// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { CancellationToken, CancellationTokenSource } from 'vscode';
import { IInstaller, Product, InstallerResponse } from '../../../kernels/installer/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { Cancellation, createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { IPythonExecutionFactory } from '../../../platform/common/process/types.node';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { BaseDataViewerDependencyImplementation } from './baseDataViewerDependencyImplementation';

/**
 * Uses the Python interpreter to manage dependencies of a Data Viewer.
 */
export class InterpreterDataViewerDependencyImplementation extends BaseDataViewerDependencyImplementation<PythonEnvironment> {
    constructor(
        private readonly installer: IInstaller,
        private pythonFactory: IPythonExecutionFactory,
        private interpreterService: IInterpreterService,
        applicationShell: IApplicationShell,
        isCodeSpace: boolean
    ) {
        super(applicationShell, isCodeSpace);
    }

    protected async _getVersion(
        interpreter: PythonEnvironment,
        token?: CancellationToken
    ): Promise<string | undefined> {
        const launcher = await this.pythonFactory.createActivatedEnvironment({
            resource: undefined,
            interpreter,
            allowEnvironmentFetchExceptions: true
        });
        const result = await launcher.exec(['-c', 'import pandas;print(pandas.__version__)'], {
            throwOnStdErr: true,
            token
        });
        return result.stdout;
    }

    protected async _doInstall(interpreter: PythonEnvironment, tokenSource: CancellationTokenSource): Promise<void> {
        // All data science dependencies require an interpreter to be passed in
        // Default to the active interpreter if no interpreter is available
        const interpreterToInstallDependenciesInto =
            interpreter || (await this.interpreterService.getActiveInterpreter());

        if (Cancellation.isCanceled(tokenSource.token)) {
            return;
        }

        const cancellationPromise = createPromiseFromCancellation({
            cancelAction: 'resolve',
            defaultValue: InstallerResponse.Ignore,
            token: tokenSource.token
        });
        // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
        const response = await Promise.race([
            this.installer.install(Product.pandas, interpreterToInstallDependenciesInto, tokenSource),
            cancellationPromise
        ]);
        if (response === InstallerResponse.Installed) {
            sendTelemetryEvent(Telemetry.UserInstalledPandas);
        }
    }

    public async checkAndInstallMissingDependencies(interpreter: PythonEnvironment): Promise<void> {
        sendTelemetryEvent(Telemetry.DataViewerUsingInterpreter);

        await this.checkOrInstall(interpreter);
    }
}
