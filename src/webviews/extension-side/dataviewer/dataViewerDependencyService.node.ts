// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { SemVer } from 'semver';
import { CancellationToken, CancellationTokenSource } from 'vscode';
import { ProductNames } from '../../../kernels/installer/productNames';
import { IInstaller, Product, InstallerResponse } from '../../../kernels/installer/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { Cancellation, createPromiseFromCancellation } from '../../../platform/common/cancellation';
import { traceWarning } from '../../../platform/logging';
import { IPythonExecutionFactory } from '../../../platform/common/process/types.node';
import { IsCodeSpace } from '../../../platform/common/types';
import { parseSemVer } from '../../../platform/common/utils.node';
import { DataScience, Common } from '../../../platform/common/utils/localize';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../webview-side/common/constants';
import { IDataViewerDependencyService } from './types';

const minimumSupportedPandaVersion = '0.20.0';

function isVersionOfPandasSupported(version: SemVer) {
    return version.compare(minimumSupportedPandaVersion) > 0;
}

/**
 * Responsible for managing dependencies of a Data Viewer.
 */
@injectable()
export class DataViewerDependencyService implements IDataViewerDependencyService {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IPythonExecutionFactory) private pythonFactory: IPythonExecutionFactory,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IsCodeSpace) private isCodeSpace: boolean
    ) {}

    public async checkAndInstallMissingDependencies(interpreter: PythonEnvironment): Promise<void> {
        const tokenSource = new CancellationTokenSource();
        try {
            const pandasVersion = await this.getVersionOfPandas(interpreter, tokenSource.token);

            if (Cancellation.isCanceled(tokenSource.token)) {
                return;
            }

            if (pandasVersion) {
                if (isVersionOfPandasSupported(pandasVersion)) {
                    return;
                }
                sendTelemetryEvent(Telemetry.PandasTooOld);
                // Warn user that we cannot start because pandas is too old.
                const versionStr = `${pandasVersion.major}.${pandasVersion.minor}.${pandasVersion.build}`;
                throw new Error(DataScience.pandasTooOldForViewingFormat().format(versionStr));
            }

            sendTelemetryEvent(Telemetry.PandasNotInstalled);
            await this.installMissingDependencies(interpreter, tokenSource);
        } finally {
            tokenSource.dispose();
        }
    }

    private async installMissingDependencies(
        interpreter: PythonEnvironment,
        tokenSource: CancellationTokenSource
    ): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!,
            pythonEnvType: interpreter?.envType
        });
        const selection = this.isCodeSpace
            ? Common.install()
            : await this.applicationShell.showErrorMessage(
                  DataScience.pandasRequiredForViewing(),
                  { modal: true },
                  Common.install()
              );

        // All data science dependencies require an interpreter to be passed in
        // Default to the active interpreter if no interpreter is available
        const interpreterToInstallDependenciesInto =
            interpreter || (await this.interpreterService.getActiveInterpreter());

        if (Cancellation.isCanceled(tokenSource.token)) {
            return;
        }

        if (selection === Common.install()) {
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
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
            throw new Error(DataScience.pandasRequiredForViewing());
        }
    }

    private async getVersionOfPandas(
        interpreter: PythonEnvironment,
        token?: CancellationToken
    ): Promise<SemVer | undefined> {
        const launcher = await this.pythonFactory.createActivatedEnvironment({
            resource: undefined,
            interpreter,
            allowEnvironmentFetchExceptions: true
        });
        try {
            const result = await launcher.exec(['-c', 'import pandas;print(pandas.__version__)'], {
                throwOnStdErr: true,
                token
            });

            return parseSemVer(result.stdout);
        } catch (ex) {
            traceWarning('Failed to get version of Pandas to use Data Viewer', ex);
            return;
        }
    }
}
