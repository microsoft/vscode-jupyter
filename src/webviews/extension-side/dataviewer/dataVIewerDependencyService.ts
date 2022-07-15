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
import { IDataViewerDependencyService, IDataViewerDependencyServiceOptions } from './types';
import { executeSilently } from '../../../kernels/helpers';
import { IKernel } from '../../../kernels/types';

export const minimumSupportedPandaVersion = '0.20.0';
export const kernelGetPandasVersion =
    'import pandas as _VSCODE_pandas;print(_VSCODE_pandas.__version__);del _VSCODE_pandas';

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

    private kernelPackaging(kernel: IKernel): '%conda' | '%pip' {
        const envType = kernel.kernelConnectionMetadata.interpreter?.envType;
        const isConda = envType === EnvironmentType.Conda;
        // From https://ipython.readthedocs.io/en/stable/interactive/magics.html#magic-pip (%conda is here as well).
        return isConda ? '%conda' : '%pip';
    }

    public async checkAndInstallMissingDependencies(options: IDataViewerDependencyServiceOptions): Promise<void> {
        const kernel = options.kernel;
        const interpreter = options.interpreter;

        if (kernel) {
            console.log('Checking and installing missing dependencies using the kernel.');
        }

        // Providing feedback as soon as possible.
        if (!kernel && !interpreter) {
            sendTelemetryEvent(Telemetry.InsufficientParameters);
            throw new Error(DataScience.insufficientParameters());
        }
        if (kernel && !kernel.session) {
            sendTelemetryEvent(Telemetry.NoActiveKernelSession);
            throw new Error(DataScience.noActiveKernelSession());
        }

        const pandasVersion = await this.getVersionOfPandas(options);

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
        await this.installMissingDependencies(options);
    }

    private async getVersionOfPandas(options: IDataViewerDependencyServiceOptions): Promise<SemVer | undefined> {
        const kernel = options.kernel;

        if (!kernel) {
            return undefined;
        }
        const command = kernelGetPandasVersion;

        try {
            const outputs = await this.executeSilently(command, options);
            return outputs.map((text) => (text ? parseSemVer(text.toString()) : undefined)).find((item) => item);
        } catch (e) {
            traceWarning(DataScience.failedToGetVersionOfPandas(), e.message);
            return;
        }
    }

    private async installMissingDependencies(options: IDataViewerDependencyServiceOptions): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!
        });

        const kernel = options.kernel;

        let selection: string | undefined;
        if (kernel) {
            selection = this.isCodeSpace
                ? Common.install()
                : await this.applicationShell.showErrorMessage(
                      DataScience.pandasRequiredForViewing(),
                      { modal: true },
                      Common.install()
                  );
        } else {
            // TODO: Installing pandas does not work with the debugger.
            // It takes a long time, then it breaks with:
            // error: Command \"clang -Wno-unused-result -Wsign-compare -Wunreachable-code...
            await this.applicationShell.showErrorMessage(DataScience.pandasRequiredForViewing());
        }

        if (!kernel) {
            return;
        }

        const command = `${this.kernelPackaging(kernel)} install pandas`;

        if (selection === Common.install()) {
            try {
                await this.executeSilently(command, options);
                sendTelemetryEvent(Telemetry.UserInstalledPandas);
            } catch (e) {
                sendTelemetryEvent(Telemetry.FailedToInstallPandas);
                throw new Error(DataScience.failedToInstallPandas());
            }
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
            throw new Error(DataScience.pandasRequiredForViewing());
        }
    }

    private async executeSilently(
        command: string,
        options: IDataViewerDependencyServiceOptions
    ): Promise<(string | undefined)[]> {
        const kernel = options.kernel;

        if (!kernel) {
            throw new Error('The Data Viewer dependency service only supports Kernels at this time.');
        }

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
