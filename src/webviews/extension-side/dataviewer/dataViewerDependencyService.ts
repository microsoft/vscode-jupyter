// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { SemVer } from 'semver';
import { ProductNames } from '../../../kernels/installer/productNames';
import { Product } from '../../../kernels/installer/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { traceWarning } from '../../../platform/logging';
import { IsCodeSpace } from '../../../platform/common/types';
import { parseSemVer } from '../../../platform/common/utils';
import { DataScience, Common } from '../../../platform/common/utils/localize';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { IDataViewerDependencyService } from './types';
import { executeSilently } from '../../../kernels/helpers';
import { IKernel } from '../../../kernels/types';

const minimumSupportedPandaVersion = '0.20.0';

function isVersionOfPandaSupported(version: SemVer) {
    return version.compare(minimumSupportedPandaVersion) > 0;
}

/**
 * Responsible for managing dependencies of a Data Viewer.
 */
@injectable()
export class DataViewerDependencyService implements IDataViewerDependencyService {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IsCodeSpace) private isCodeSpace: boolean
    ) {}

    private packaging(kernel: IKernel): 'pip' | 'conda' {
        const envType = kernel.kernelConnectionMetadata.interpreter?.envType;
        const isConda = envType === EnvironmentType.Conda;
        return isConda ? 'conda' : 'pip';
    }

    public async checkAndInstallMissingDependenciesOnEnvironment(): Promise<void> {
        throw new Error('Not implemented');
    }

    public async checkAndInstallMissingDependenciesOnKernel(kernel: IKernel): Promise<void> {
        const pandasVersion = await this.getVersionOfPandas(kernel);

        if (pandasVersion) {
            if (isVersionOfPandaSupported(pandasVersion)) {
                return;
            }
            sendTelemetryEvent(Telemetry.PandasTooOld);
            // Warn user that we cannot start because pandas is too old.
            const versionStr = `${pandasVersion.major}.${pandasVersion.minor}.${pandasVersion.build}`;
            throw new Error(DataScience.pandasTooOldForViewingFormat().format(versionStr));
        }

        sendTelemetryEvent(Telemetry.PandasNotInstalled);
        await this.installMissingDependencies(kernel);
    }

    private async installMissingDependencies(kernel: IKernel): Promise<void> {
        if (!kernel.session) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error(DataScience.noActiveKernelSession());
        }

        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!
        });

        const selection = this.isCodeSpace
            ? Common.install()
            : await this.applicationShell.showErrorMessage(
                  DataScience.pandasRequiredForViewing(),
                  { modal: true },
                  Common.install()
              );

        const command = `${this.packaging(kernel)} install pandas`;

        if (selection === Common.install()) {
            try {
                await this.executeSilently(command, kernel);
                sendTelemetryEvent(Telemetry.UserInstalledPandas);
            } catch (e) {
                console.log('Error installing pandas', e);
                sendTelemetryEvent(Telemetry.FailedToInstallPandas);
                throw new Error(DataScience.failedToInstallPandas());
            }
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
            throw new Error(DataScience.pandasRequiredForViewing());
        }
    }

    private async getVersionOfPandas(kernel: IKernel): Promise<SemVer | undefined> {
        const command = 'import pandas;print(pandas.__version__)';
        try {
            const outputs = await this.executeSilently(command, kernel);
            return outputs.map((text) => (text ? parseSemVer(text.toString()) : undefined)).find((item) => item);
        } catch (e) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), e.message);
            return;
        }
    }

    private async executeSilently(command: string, kernel: IKernel): Promise<(string | undefined)[]> {
        if (!kernel.session) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error(DataScience.noActiveKernelSession());
        }
        const outputs = await executeSilently(kernel.session, command);
        const error = outputs.find((item) => item.output_type === 'error');
        if (error) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), error.message);
        }
        return outputs.map((item) => item.text?.toString());
    }
}
