// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { traceWarning } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { executeSilently } from '../../../kernels/helpers';
import { IKernel, IKernelConnectionSession } from '../../../kernels/types';
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
export class KernelDataViewerDependencyImplementation extends BaseDataViewerDependencyImplementation<IKernel> {
    protected async execute(command: string, kernel: IKernelWithSession): Promise<(string | undefined)[]> {
        const outputs = await executeSilently(kernel.session, command);
        const error = outputs.find((item) => item.output_type === 'error');
        if (error) {
            traceWarning(DataScience.failedToGetVersionOfPandas, error.message);
        }
        return outputs.map((item) => item.text?.toString());
    }

    protected async _getVersion(kernel: IKernelWithSession): Promise<string | undefined> {
        const outputs = await this.execute(kernelGetPandasVersion, kernel);
        return outputs.map((text) => (text ? text.toString() : undefined)).find((item) => item);
    }

    protected async _doInstall(kernel: IKernelWithSession): Promise<void> {
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

        if (!kernelHasSession(kernel)) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error('No no active kernel session.');
        }

        await this.checkOrInstall(kernel);
    }
}
