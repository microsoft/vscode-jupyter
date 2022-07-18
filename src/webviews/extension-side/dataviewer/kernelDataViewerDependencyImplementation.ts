// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { SemVer } from 'semver';
import { ProductNames } from '../../../kernels/installer/productNames';
import { Product } from '../../../kernels/installer/types';
import { traceWarning } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { executeSilently } from '../../../kernels/helpers';
import { IKernel, IKernelConnectionSession } from '../../../kernels/types';
import { parseSemVer } from '../../../platform/common/utils';
import { pandasMinimumVersionSupportedByVariableViewer } from './constants';
import { BaseDataViewerDependencyImplementation } from './baseDataViewerDependencyImplementation';

export const kernelGetPandasVersion =
    'import pandas as _VSCODE_pandas;print(_VSCODE_pandas.__version__);del _VSCODE_pandas';

function kernelPackaging(kernel: IKernel): '%conda' | '%pip' {
    const envType = kernel.kernelConnectionMetadata.interpreter?.envType;
    const isConda = envType === EnvironmentType.Conda;
    // From https://ipython.readthedocs.io/en/stable/interactive/magics.html#magic-pip (%conda is here as well).
    return isConda ? '%conda' : '%pip';
}

type IKernelWithSession = IKernel & { session: IKernelConnectionSession };

// TypeScript will narrow the type to PythonEnvironment in any block guarded by a call to isPythonEnvironment
function kernelHasSession(kernel: IKernel): kernel is IKernelWithSession {
    return Boolean(kernel.session);
}

/**
 * Uses the Kernel to manage the dependencies of a Data Viewer.
 */
export class KernelDataViewerDependencyImplementation extends BaseDataViewerDependencyImplementation {
    protected async execute(command: string, kernel: IKernelWithSession): Promise<(string | undefined)[]> {
        const outputs = await executeSilently(kernel.session, command);
        const error = outputs.find((item) => item.output_type === 'error');
        if (error) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), error.message);
        }
        return outputs.map((item) => item.text?.toString());
    }

    protected async getVersion(kernel: IKernelWithSession): Promise<SemVer | undefined> {
        try {
            const outputs = await this.execute(kernelGetPandasVersion, kernel);
            return outputs.map((text) => (text ? parseSemVer(text.toString()) : undefined)).find((item) => item);
        } catch (e) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), e.message);
            return;
        }
    }

    private async installMissingDependencies(kernel: IKernelWithSession): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!
        });

        const command = `${kernelPackaging(kernel)} install pandas`;

        if (await this.promptInstall()) {
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
        sendTelemetryEvent(Telemetry.DataViewerUsingKernel);

        if (!kernelHasSession(kernel)) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error('No no active kernel session.');
        }

        const pandasVersion = await this.getVersion(kernel);

        if (pandasVersion) {
            if (pandasVersion.compare(pandasMinimumVersionSupportedByVariableViewer) > 0) {
                sendTelemetryEvent(Telemetry.PandasOK);
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
