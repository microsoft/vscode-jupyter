// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import { createPromiseFromCancellation, wrapCancellationTokens } from '../../../common/cancellation';
import { isModulePresentInEnvironment } from '../../../common/installer/productInstaller';
import { ProductNames } from '../../../common/installer/productNames';
import { traceDecorators, traceError, traceInfo } from '../../../common/logger';
import { getDisplayPath } from '../../../common/platform/fs-paths';
import {
    GLOBAL_MEMENTO,
    IInstaller,
    IMemento,
    InstallerResponse,
    IsCodeSpace,
    Product,
    Resource
} from '../../../common/types';
import { Common, DataScience } from '../../../common/utils/localize';
import { IServiceContainer } from '../../../ioc/types';
import { TraceOptions } from '../../../logging/trace';
import { EnvironmentType, PythonEnvironment } from '../../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../telemetry/helpers';
import { getResourceType } from '../../common';
import { Telemetry } from '../../constants';
import { IpyKernelNotInstalledError } from '../../errors/ipyKernelNotInstalledError';
import { IInteractiveWindowProvider, IKernelDependencyService, KernelInterpreterDependencyResponse } from '../../types';
import { selectKernel } from './kernelSelector';

/**
 * Responsible for managing dependencies of a Python interpreter required to run as a Jupyter Kernel.
 * If required modules aren't installed, will prompt user to install them.
 */
@injectable()
export class KernelDependencyService implements IKernelDependencyService {
    private installPromises = new Map<string, Promise<KernelInterpreterDependencyResponse>>();
    constructor(
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IsCodeSpace) private readonly isCodeSpace: boolean,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IServiceContainer) protected serviceContainer: IServiceContainer // @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider
    ) {}
    /**
     * Configures the python interpreter to ensure it can run a Jupyter Kernel by installing any missing dependencies.
     * If user opts not to install they can opt to select another interpreter.
     */
    @traceDecorators.verbose('Install Missing Dependencies', TraceOptions.ReturnValue)
    public async installMissingDependencies(
        resource: Resource,
        interpreter: PythonEnvironment,
        token?: CancellationToken,
        disableUI?: boolean
    ): Promise<void> {
        traceInfo(`installMissingDependencies ${getDisplayPath(interpreter.path)}`);
        if (await this.areDependenciesInstalled(interpreter, token)) {
            return;
        }
        if (token?.isCancellationRequested) {
            return;
        }

        // Cache the install run
        let promise = this.installPromises.get(interpreter.path);
        if (!promise) {
            promise = this.runInstaller(resource, interpreter, token, disableUI);
            this.installPromises.set(interpreter.path, promise);
        }

        // Get the result of the question
        try {
            const result = await promise;
            if (token?.isCancellationRequested) {
                return;
            }
            await this.handleKernelDependencyResponse(result, interpreter, resource);
        } finally {
            // Don't need to cache anymore
            this.installPromises.delete(interpreter.path);
        }
    }
    public areDependenciesInstalled(interpreter: PythonEnvironment, token?: CancellationToken): Promise<boolean> {
        return Promise.race([
            this.installer.isInstalled(Product.ipykernel, interpreter).then((installed) => installed === true),
            createPromiseFromCancellation({ token, defaultValue: false, cancelAction: 'resolve' })
        ]);
    }

    private async handleKernelDependencyResponse(
        response: KernelInterpreterDependencyResponse,
        interpreter: PythonEnvironment,
        resource: Resource
    ) {
        if (response === KernelInterpreterDependencyResponse.ok) {
            return;
        }
        if (response === KernelInterpreterDependencyResponse.selectDifferentKernel) {
            await selectKernel(
                resource,
                this.notebooks,
                this.serviceContainer.get(IInteractiveWindowProvider),
                this.commandManager
            );
            // If selecting a new kernel, the current code paths don't allow us to just change a kernel on the fly.
            // We pass kernel connection information around, hence if ther'es a change we need to start all over again.
            // Throwing this exception will get the user to start again.
        }
        const message = interpreter.displayName
            ? `${interpreter.displayName}:${getDisplayPath(interpreter.path)}`
            : getDisplayPath(interpreter.path);
        throw new IpyKernelNotInstalledError(DataScience.ipykernelNotInstalled().format(message), response);
    }
    private async runInstaller(
        resource: Resource,
        interpreter: PythonEnvironment,
        token?: CancellationToken,
        disableUI?: boolean
    ): Promise<KernelInterpreterDependencyResponse> {
        // If there's no UI, then cancel installation.
        if (disableUI) {
            return KernelInterpreterDependencyResponse.cancel;
        }
        const installerToken = wrapCancellationTokens(token);
        const [isModulePresent, isPipAvailableForNonConda] = await Promise.all([
            isModulePresentInEnvironment(this.memento, Product.ipykernel, interpreter),
            interpreter.envType === EnvironmentType.Conda
                ? undefined
                : await this.installer.isInstalled(Product.pip, interpreter)
        ]);
        if (installerToken.isCancellationRequested) {
            return KernelInterpreterDependencyResponse.cancel;
        }
        const messageFormat = isModulePresent
            ? DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreterAndRequiresUpdate()
            : DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter();
        const products = isPipAvailableForNonConda === false ? [Product.ipykernel, Product.pip] : [Product.ipykernel];
        const message = messageFormat.format(
            interpreter.displayName || interpreter.path,
            products.map((product) => ProductNames.get(product)!).join(` ${Common.and()} `)
        );
        const productNameForTelemetry = products.map((product) => ProductNames.get(product)!).join(', ');
        const resourceType = resource ? getResourceType(resource) : undefined;
        const resourceHash = resource ? getTelemetrySafeHashedString(resource.toString()) : undefined;
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: productNameForTelemetry,
            resourceType,
            resourceHash
        });
        const promptCancellationPromise = createPromiseFromCancellation({
            cancelAction: 'resolve',
            defaultValue: undefined,
            token
        });
        const installPrompt = isModulePresent ? Common.reInstall() : Common.install();
        const selectKernel = DataScience.selectKernel();
        // Due to a bug in our code, if we don't have a resource, don't display the option to change kernels.
        // https://github.com/microsoft/vscode-jupyter/issues/6135
        const options = resource ? [installPrompt, selectKernel] : [installPrompt];
        try {
            if (!this.isCodeSpace) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'prompted',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash
                });
            }
            const selection = this.isCodeSpace
                ? installPrompt
                : await Promise.race([
                      this.appShell.showErrorMessage(message, { modal: true }, ...options),
                      promptCancellationPromise
                  ]);
            if (installerToken.isCancellationRequested) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'dismissed',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash
                });
                return KernelInterpreterDependencyResponse.cancel;
            }

            if (selection === selectKernel) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'differentKernel',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash
                });
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            } else if (selection === installPrompt) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'install',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash
                });
                const cancellationPromise = createPromiseFromCancellation({
                    cancelAction: 'resolve',
                    defaultValue: InstallerResponse.Ignore,
                    token
                });
                // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
                const response = await Promise.race([
                    this.installer.install(
                        Product.ipykernel,
                        interpreter,
                        installerToken,
                        isModulePresent === true,
                        isPipAvailableForNonConda === false
                    ),
                    cancellationPromise
                ]);
                if (response === InstallerResponse.Installed) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                        action: 'installed',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash
                    });
                    return KernelInterpreterDependencyResponse.ok;
                } else if (response === InstallerResponse.Ignore) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                        action: 'failed',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash
                    });
                    return KernelInterpreterDependencyResponse.failed; // Happens when errors in pip or conda.
                }
            }

            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action: 'dismissed',
                moduleName: productNameForTelemetry,
                resourceType,
                resourceHash
            });
            return KernelInterpreterDependencyResponse.cancel;
        } catch (ex) {
            traceError(`Failed to install ${productNameForTelemetry}`, ex);
            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action: 'error',
                moduleName: productNameForTelemetry,
                resourceType,
                resourceHash
            });
            throw ex;
        }
    }
}
