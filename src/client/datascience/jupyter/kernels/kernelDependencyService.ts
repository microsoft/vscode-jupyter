// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { IApplicationShell } from '../../../common/application/types';
import { createPromiseFromCancellation, wrapCancellationTokens } from '../../../common/cancellation';
import { ProductNames } from '../../../common/installer/productNames';
import { traceDecorators, traceInfo } from '../../../common/logger';
import { IInstaller, InstallerResponse, Product } from '../../../common/types';
import { Common, DataScience } from '../../../common/utils/localize';
import { TraceOptions } from '../../../logging/trace';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { IKernelDependencyService, KernelInterpreterDependencyResponse } from '../../types';

/**
 * Responsible for managing dependencies of a Python interpreter required to run as a Jupyter Kernel.
 * If required modules aren't installed, will prompt user to install them.
 */
@injectable()
export class KernelDependencyService implements IKernelDependencyService {
    constructor(
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IInstaller) private readonly installer: IInstaller
    ) {}
    /**
     * Configures the python interpreter to ensure it can run a Jupyter Kernel by installing any missing dependencies.
     * If user opts not to install they can opt to select another interpreter.
     */
    @traceDecorators.verbose('Install Missing Dependencies', TraceOptions.ReturnValue)
    public async installMissingDependencies(
        interpreter: PythonEnvironment,
        token?: CancellationToken,
        disableUI?: boolean
    ): Promise<KernelInterpreterDependencyResponse> {
        traceInfo(`installMissingDependencies ${interpreter.path}`);
        if (await this.areDependenciesInstalled(interpreter, token)) {
            return KernelInterpreterDependencyResponse.ok;
        }

        const promptCancellationPromise = createPromiseFromCancellation({
            cancelAction: 'resolve',
            defaultValue: undefined,
            token
        });
        const message = DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter().format(
            interpreter.displayName || interpreter.path,
            ProductNames.get(Product.ipykernel)!
        );
        const installerToken = wrapCancellationTokens(token);
        // If there's no UI, then cancel installation.
        if (disableUI) {
            return KernelInterpreterDependencyResponse.cancel;
        }
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.ipykernel)!
        });
        const selection = await Promise.race([
            this.appShell.showErrorMessage(message, Common.install()),
            promptCancellationPromise
        ]);
        if (installerToken.isCancellationRequested) {
            return KernelInterpreterDependencyResponse.cancel;
        }

        if (selection === Common.install()) {
            const cancellationPromise = createPromiseFromCancellation({
                cancelAction: 'resolve',
                defaultValue: InstallerResponse.Ignore,
                token
            });
            // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
            const response = await Promise.race([
                this.installer.install(Product.ipykernel, interpreter, installerToken),
                cancellationPromise
            ]);
            if (response === InstallerResponse.Installed) {
                return KernelInterpreterDependencyResponse.ok;
            } else if (response === InstallerResponse.Ignore) {
                return KernelInterpreterDependencyResponse.failed; // This happens when pip or conda can't be started
            }
        }
        return KernelInterpreterDependencyResponse.cancel;
    }
    public areDependenciesInstalled(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean> {
        return this.installer.isInstalled(Product.ipykernel, interpreter).then((installed) => installed === true);
    }
}
