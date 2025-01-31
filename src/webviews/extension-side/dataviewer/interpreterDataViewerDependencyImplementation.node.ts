// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource } from 'vscode';
import { IInstaller, Product, InstallerResponse } from '../../../platform/interpreter/installer/types';
import { raceCancellation } from '../../../platform/common/cancellation';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IPythonExecutionFactory } from '../../../platform/interpreter/types.node';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { BaseDataViewerDependencyImplementation } from './baseDataViewerDependencyImplementation';
import { logger } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { splitLines } from '../../../platform/common/helpers';

const separator = '5dc3a68c-e34e-4080-9c3e-2a532b2ccb4d';
export const interpreterGetPandasVersion = `import pandas;print(pandas.__version__);print("${separator}")`;

/**
 * Uses the Python interpreter to manage dependencies of a Data Viewer.
 */
export class InterpreterDataViewerDependencyImplementation extends BaseDataViewerDependencyImplementation<PythonEnvironment> {
    constructor(
        private readonly installer: IInstaller,
        private pythonFactory: IPythonExecutionFactory,
        private interpreterService: IInterpreterService
    ) {
        super();
    }

    protected async _getVersion(
        interpreter: PythonEnvironment,
        token?: CancellationToken
    ): Promise<string | undefined> {
        const launcher = await this.pythonFactory.createActivatedEnvironment({
            resource: undefined,
            interpreter
        });
        const result = await launcher.exec(['-c', interpreterGetPandasVersion], {
            token
        });
        const output = result.stdout;

        if (!output?.includes(separator)) {
            logger.warn(DataScience.failedToGetVersionOfPandas, `Output is ${output}`);
            return '';
        }
        const items = splitLines(output.trim());
        const indexOfSeparator = items.indexOf(separator);
        return indexOfSeparator >= 0 ? items[indexOfSeparator - 1] : '';
    }

    protected async _doInstall(interpreter: PythonEnvironment, tokenSource: CancellationTokenSource): Promise<void> {
        // All data science dependencies require an interpreter to be passed in
        // Default to the active interpreter if no interpreter is available
        const interpreterToInstallDependenciesInto =
            interpreter || (await this.interpreterService.getActiveInterpreter());

        if (tokenSource.token.isCancellationRequested) {
            return;
        }

        // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
        const response = await raceCancellation(
            tokenSource.token,
            InstallerResponse.Ignore,
            this.installer.install(Product.pandas, interpreterToInstallDependenciesInto, tokenSource)
        );
        if (response === InstallerResponse.Installed) {
            sendTelemetryEvent(Telemetry.UserInstalledPandas);
        }
    }

    public async checkAndInstallMissingDependencies(interpreter: PythonEnvironment): Promise<void> {
        sendTelemetryEvent(Telemetry.DataViewerUsingInterpreter);

        await this.checkOrInstall(interpreter);
    }
}
