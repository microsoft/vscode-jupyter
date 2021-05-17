// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento } from 'vscode';
import { wrapCancellationTokens } from '../../../common/cancellation';
import { isModulePresentInEnvironment } from '../../../common/installer/productInstaller';
import { ProductNames } from '../../../common/installer/productNames';
import { traceDecorators, traceInfo } from '../../../common/logger';
import { GLOBAL_MEMENTO, IInstaller, IMemento, InstallerResponse, IsCodeSpace, Product } from '../../../common/types';
import { DataScience } from '../../../common/utils/localize';
import { TraceOptions } from '../../../logging/trace';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { IpyKernelNotInstalledError } from '../../kernel-launcher/types';
import { IKernelDependencyService, KernelInterpreterDependencyResponse } from '../../types';

/**
 * Responsible for managing dependencies of a Python interpreter required to run as a Jupyter Kernel.
 * If required modules aren't installed, will prompt user to install them.
 */
@injectable()
export class KernelDependencyService implements IKernelDependencyService {
    private installPromises = new Map<string, Promise<KernelInterpreterDependencyResponse>>();
    constructor(
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IsCodeSpace) private readonly isCodeSpace: boolean
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
    ): Promise<void> {
        traceInfo(`installMissingDependencies ${interpreter.path}`);
        if (await this.areDependenciesInstalled(interpreter, token)) {
            return;
        }

        // Cache the install run
        let promise = this.installPromises.get(interpreter.path);
        if (!promise) {
            promise = this.runInstaller(interpreter, token, disableUI);
            this.installPromises.set(interpreter.path, promise);
        }

        // Get the result of the question
        try {
            const result = await promise;
            if (result !== KernelInterpreterDependencyResponse.ok) {
                throw new IpyKernelNotInstalledError(
                    DataScience.ipykernelNotInstalled().format(
                        `${interpreter.displayName || interpreter.path}:${interpreter.path}`
                    ),
                    result
                );
            }
        } finally {
            // Don't need to cache anymore
            this.installPromises.delete(interpreter.path);
        }
    }
    public areDependenciesInstalled(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean> {
        return this.installer.isInstalled(Product.ipykernel, interpreter).then((installed) => installed === true);
    }

    private async runInstaller(
        interpreter: PythonEnvironment,
        token?: CancellationToken,
        disableUI?: boolean
    ): Promise<KernelInterpreterDependencyResponse> {
        // If there's no UI, then cancel installation.
        if (disableUI) {
            return KernelInterpreterDependencyResponse.cancel;
        }
        const isModulePresent = await isModulePresentInEnvironment(this.memento, Product.ipykernel, interpreter);
        const messageFormat = isModulePresent
            ? DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreterAndRequiresUpdate()
            : DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter();
        const message = messageFormat.format(
            interpreter.displayName || interpreter.path,
            ProductNames.get(Product.ipykernel)!
        );
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.ipykernel)!
        });

        // Do not prompt in codespaces.
        const showPrompt = !this.isCodeSpace;
        // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
        const installerToken = wrapCancellationTokens(token);
        return this.installer
            .install(Product.ipykernel, interpreter, installerToken, {
                reInstallAndUpdate: isModulePresent === true,
                modal: true,
                message: showPrompt ? message : undefined
            })
            .then((result) => {
                if (installerToken.isCancellationRequested) {
                    return KernelInterpreterDependencyResponse.cancel;
                }
                switch (result) {
                    case InstallerResponse.Installed:
                        return KernelInterpreterDependencyResponse.ok;
                    case InstallerResponse.Ignore:
                        return KernelInterpreterDependencyResponse.failed; // Happens when errors in pip or conda.
                    case InstallerResponse.Disabled:
                        return KernelInterpreterDependencyResponse.cancel;
                }
            });
    }
}
