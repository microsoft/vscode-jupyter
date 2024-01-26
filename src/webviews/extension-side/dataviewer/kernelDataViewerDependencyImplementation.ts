// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { traceWarning } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { executeSilently } from '../../../kernels/helpers';
import { IKernel } from '../../../kernels/types';
import { BaseDataViewerDependencyImplementation } from './baseDataViewerDependencyImplementation';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { splitLines } from '../../../platform/common/helpers';

const separator = '5dc3a68c-e34e-4080-9c3e-2a532b2ccb4d';
export const kernelGetPandasVersion = `import warnings as _VSCODE_warnings;_VSCODE_warnings.filterwarnings("ignore", category=DeprecationWarning);import pandas as _VSCODE_pandas;print(_VSCODE_pandas.__version__);print("${separator}"); del _VSCODE_pandas; del _VSCODE_warnings`;

function kernelPackaging(kernel: IKernel): '%conda' | '%pip' {
    const envType = kernel.kernelConnectionMetadata.interpreter?.envType;
    const isConda = envType === EnvironmentType.Conda;
    // From https://ipython.readthedocs.io/en/stable/interactive/magics.html#magic-pip (%conda is here as well).
    return isConda ? '%conda' : '%pip';
}

/**
 * Uses the Kernel to manage the dependencies of a Data Viewer.
 */
export class KernelDataViewerDependencyImplementation extends BaseDataViewerDependencyImplementation<IKernel> {
    protected async execute(command: string, kernel: IKernel): Promise<(string | undefined)[]> {
        if (!kernel.session?.kernel) {
            throw new SessionDisposedError();
        }
        const outputs = await executeSilently(kernel.session.kernel, command);
        const error = outputs.find((item) => item.output_type === 'error');
        if (error) {
            traceWarning(DataScience.failedToGetVersionOfPandas, error.message);
        }
        return outputs.map((item) => item.text?.toString());
    }

    protected async _getVersion(kernel: IKernel): Promise<string | undefined> {
        const outputs = await this.execute(kernelGetPandasVersion, kernel);
        const output = outputs.map((text) => (text ? text.toString() : undefined)).find((item) => item);
        if (!output?.includes(separator)) {
            traceWarning(DataScience.failedToGetVersionOfPandas, `Output is ${output}`);
            return '';
        }
        const items = splitLines(output.trim());
        const indexOfSeparator = items.indexOf(separator);
        return indexOfSeparator >= 0 ? items[indexOfSeparator - 1] : '';
    }

    protected async _doInstall(kernel: IKernel): Promise<void> {
        const command = `${kernelPackaging(kernel)} install pandas`;

        try {
            await this.execute(command, kernel);
            sendTelemetryEvent(Telemetry.UserInstalledPandas);
        } catch (e) {
            sendTelemetryEvent(Telemetry.UserInstalledPandas, undefined, undefined, e);
            throw new Error(DataScience.failedToInstallPandas);
        }
    }

    async checkAndInstallMissingDependencies(kernel: IKernel): Promise<void> {
        sendTelemetryEvent(Telemetry.DataViewerUsingKernel);

        if (!kernel.session?.kernel) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error('No no active kernel session.');
        }

        await this.checkOrInstall(kernel);
    }
}
