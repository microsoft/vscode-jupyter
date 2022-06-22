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
import { EnvironmentType, PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../webview-side/common/constants';
import { IDataViewerDependencyService } from './types';
import { executeSilently } from '../../../kernels/helpers';
import { IJupyterSession, IKernel, IKernelProvider } from '../../../kernels/types';

const minimumSupportedPandaVersion = '0.20.0';

function isVersionOfPandasSupported(version: SemVer) {
    return version.compare(minimumSupportedPandaVersion) > 0;
}

/**
 * Responsible for managing dependencies of a Data Viewer.
 */
@injectable()
export class DataViewerDependencyService implements IDataViewerDependencyService {
    private get kernel(): IKernel {
        const kernel = this.kernelProvider.kernels.find((kernel) => kernel.status === 'idle');
        if (!kernel) {
            sendTelemetryEvent(Telemetry.NoActiveKernel);
            throw new Error(DataScience.noActiveKernel());
        }
        return kernel;
    }
    private get kernelSession(): IJupyterSession {
        if (!this.kernel.session) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error(DataScience.noActiveKernel());
        }
        return this.kernel.session;
    }
    private get packaging(): string {
        const envType = this.kernel.kernelConnectionMetadata.interpreter?.envType;
        const isConda = envType === EnvironmentType.Conda;
        return isConda ? 'conda' : 'pip';
    }

    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IsCodeSpace) private isCodeSpace: boolean
    ) {}

    public async checkAndInstallMissingDependencies(interpreter: PythonEnvironment): Promise<void> {
        const pandasVersion = await this.getVersionOfPandas();
        console.log({ pandasVersion });

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
        await this.installMissingDependencies(interpreter);
    }

    private async installMissingDependencies(interpreter: PythonEnvironment): Promise<void> {
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

        if (selection === Common.install()) {
            const outputs = await executeSilently(this.kernelSession, `${this.packaging} install pandas`);

            if (outputs.some((item) => item.output_type === 'error')) {
                sendTelemetryEvent(Telemetry.FailedToInstallPandas);
            } else {
                sendTelemetryEvent(Telemetry.UserInstalledPandas);
            }
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
            throw new Error(DataScience.pandasRequiredForViewing());
        }
    }

    private async getVersionOfPandas(): Promise<SemVer | undefined> {
        const outputs = await executeSilently(this.kernelSession, `import pandas; print(pandas.__version__)`);
        console.log({ outputs });

        const error = outputs.find((item) => item.output_type === 'error');
        if (error) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), error.text);
            return;
        } else {
            return outputs.map(({ text }) => (text ? parseSemVer(text.toString()) : undefined)).find((item) => item);
        }
    }
}
