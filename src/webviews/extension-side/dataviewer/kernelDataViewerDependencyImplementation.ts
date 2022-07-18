// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { SemVer } from 'semver';
import { ProductNames } from '../../../kernels/installer/productNames';
import { Product } from '../../../kernels/installer/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { traceWarning } from '../../../platform/logging';
import { DataScience, Common } from '../../../platform/common/utils/localize';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { executeSilently } from '../../../kernels/helpers';
import { IKernel } from '../../../kernels/types';
import { parseSemVer } from '../../../platform/common/utils';
import { IDataViewerDependencyService } from './types';
import { pandasMinimumVersionSupportedByVariableViewer } from './constants';

export const kernelGetPandasVersion =
    'import pandas as _VSCODE_pandas;print(_VSCODE_pandas.__version__);del _VSCODE_pandas';

function kernelPackaging(kernel: IKernel): '%conda' | '%pip' {
    const envType = kernel.kernelConnectionMetadata.interpreter?.envType;
    const isConda = envType === EnvironmentType.Conda;
    // From https://ipython.readthedocs.io/en/stable/interactive/magics.html#magic-pip (%conda is here as well).
    return isConda ? '%conda' : '%pip';
}

/**
 * Uses the Kernel to manage the dependencies of a Data Viewer.
 */
export class KernelDataViewerDependencyImplementation implements IDataViewerDependencyService {
    constructor(private readonly applicationShell: IApplicationShell, private isCodeSpace: boolean) {}

    protected async execute(command: string, kernel: IKernel): Promise<(string | undefined)[]> {
        const outputs = await executeSilently(kernel.session!, command);
        const error = outputs.find((item) => item.output_type === 'error');
        if (error) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), error.message);
        }
        return outputs.map((item) => item.text?.toString());
    }

    protected async getVersion(kernel: IKernel): Promise<SemVer | undefined> {
        try {
            const outputs = await this.execute(kernelGetPandasVersion, kernel);
            return outputs.map((text) => (text ? parseSemVer(text.toString()) : undefined)).find((item) => item);
        } catch (e) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), e.message);
            return;
        }
    }

    private async installMissingDependencies(kernel: IKernel): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!
        });

        let selection = this.isCodeSpace
            ? Common.install()
            : await this.applicationShell.showErrorMessage(
                  DataScience.pandasRequiredForViewing().format(pandasMinimumVersionSupportedByVariableViewer),
                  { modal: true },
                  Common.install()
              );

        const command = `${kernelPackaging(kernel)} install pandas`;

        if (selection === Common.install()) {
            try {
                await this.execute(command, kernel);
                sendTelemetryEvent(Telemetry.UserInstalledPandas);
            } catch (e) {
                sendTelemetryEvent(Telemetry.UserInstalledPandas, undefined, undefined, e);
                throw new Error(DataScience.failedToInstallPandas());
            }
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
            throw new Error(
                DataScience.pandasRequiredForViewing().format(pandasMinimumVersionSupportedByVariableViewer)
            );
        }
    }

    async checkAndInstallMissingDependencies(kernel: IKernel): Promise<void> {
        if (!kernel.session) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error(DataScience.noActiveKernelSession());
        }

        const pandasVersion = await this.getVersion(kernel);

        if (pandasVersion) {
            if (pandasVersion.compare(pandasMinimumVersionSupportedByVariableViewer) > 0) {
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
}
