// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, Memento } from 'vscode';
import { IApplicationShell } from '../client/common/application/types';
import { createPromiseFromCancellation } from '../client/common/cancellation';
import { traceInfo, traceError, traceInfoIfCI } from '../client/common/logger';
import { getDisplayPath } from '../client/common/platform/fs-paths';
import { IMemento, GLOBAL_MEMENTO, IsCodeSpace, Resource } from '../client/common/types';
import { DataScience, Common } from '../client/common/utils/localize';
import { noop } from '../client/common/utils/misc';
import { getResourceType } from '../client/datascience/common';
import { KernelProgressReporter } from '../client/datascience/progress/kernelProgressReporter';
import {
    IKernelDependencyService,
    KernelInterpreterDependencyResponse,
    IRawNotebookSupportedService,
    IDisplayOptions
} from '../client/datascience/types';
import { IServiceContainer } from '../client/ioc/types';
import { traceDecorators } from '../client/logging';
import { ignoreLogging, logValue } from '../client/logging/trace';
import { EnvironmentType, PythonEnvironment } from '../client/pythonEnvironments/info';
import { sendTelemetryEvent } from '../client/telemetry';
import { getTelemetrySafeHashedString } from '../client/telemetry/helpers';
import { Telemetry } from '../datascience-ui/common/constants';
import {
    isModulePresentInEnvironmentCache,
    trackPackageInstalledIntoInterpreter,
    isModulePresentInEnvironment
} from './installer/productInstaller';
import { ProductNames } from './installer/productNames';
import { IInstaller, Product, InstallerResponse } from './installer/types';
import { KernelConnectionMetadata } from './types';

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
        @inject(IRawNotebookSupportedService) private readonly rawSupport: IRawNotebookSupportedService,
        @inject(IServiceContainer) protected serviceContainer: IServiceContainer // @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider
    ) {}
    /**
     * Configures the python interpreter to ensure it can run a Jupyter Kernel by installing any missing dependencies.
     * If user opts not to install they can opt to select another interpreter.
     */
    @traceDecorators.verbose('Install Missing Dependencies')
    public async installMissingDependencies(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        ui: IDisplayOptions,
        @ignoreLogging() token: CancellationToken,
        ignoreCache?: boolean
    ): Promise<KernelInterpreterDependencyResponse> {
        traceInfo(
            `installMissingDependencies ${getDisplayPath(kernelConnection.interpreter?.path)}, ui.disabled=${
                ui.disableUI
            } for resource ${getDisplayPath(resource)}`
        );
        if (
            kernelConnection.kind === 'connectToLiveKernel' ||
            kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
            kernelConnection.interpreter === undefined
        ) {
            return KernelInterpreterDependencyResponse.ok;
        }
        const alreadyInstalled = await KernelProgressReporter.wrapAndReportProgress(
            resource,
            DataScience.validatingKernelDependencies(),
            () => this.areDependenciesInstalled(kernelConnection, token, ignoreCache)
        );
        if (alreadyInstalled) {
            return KernelInterpreterDependencyResponse.ok;
        }
        if (token?.isCancellationRequested) {
            return KernelInterpreterDependencyResponse.cancel;
        }

        // Cache the install run
        let promise = this.installPromises.get(kernelConnection.interpreter.path);
        let cancelTokenSource: CancellationTokenSource | undefined;
        if (!promise) {
            const cancelTokenSource = new CancellationTokenSource();
            const disposable = token.onCancellationRequested(() => {
                cancelTokenSource.cancel();
                disposable.dispose();
            });
            promise = KernelProgressReporter.wrapAndReportProgress(
                resource,
                DataScience.installingMissingDependencies(),
                () => this.runInstaller(resource, kernelConnection.interpreter!, ui, cancelTokenSource)
            );
            promise
                .finally(() => {
                    disposable.dispose();
                    cancelTokenSource.dispose();
                })
                .catch(noop);
            this.installPromises.set(kernelConnection.interpreter.path, promise);
        }

        // Get the result of the question
        let dependencyResponse: KernelInterpreterDependencyResponse = KernelInterpreterDependencyResponse.failed;
        try {
            // This can throw an exception (if say it fails to install) or it can cancel
            dependencyResponse = await promise;
            if (cancelTokenSource?.token?.isCancellationRequested || token.isCancellationRequested) {
                dependencyResponse = KernelInterpreterDependencyResponse.cancel;
            }
        } catch (ex) {
            traceInfoIfCI(`Failed to install kernel dependency`, ex);
            // Failure occurred
            dependencyResponse = KernelInterpreterDependencyResponse.failed;
        } finally {
            // Don't need to cache anymore
            this.installPromises.delete(kernelConnection.interpreter.path);
        }
        return dependencyResponse;
    }
    @traceDecorators.verbose('Are Dependencies Installed')
    public async areDependenciesInstalled(
        @logValue<KernelConnectionMetadata>('id') kernelConnection: KernelConnectionMetadata,
        token?: CancellationToken,
        ignoreCache?: boolean
    ): Promise<boolean> {
        if (
            kernelConnection.kind === 'connectToLiveKernel' ||
            kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
            kernelConnection.interpreter === undefined
        ) {
            return true;
        }
        // Check cache, faster than spawning process every single time.
        // Makes a big difference with conda on windows.
        if (
            !ignoreCache &&
            // When dealing with Jupyter (non-raw), don't cache, always check.
            // The reason is even if ipykernel isn't available, the kernel will still be started (i.e. the process is started),
            // However Jupyter doesn't notify a failure to start.
            this.rawSupport.isSupported &&
            isModulePresentInEnvironmentCache(this.memento, Product.ipykernel, kernelConnection.interpreter)
        ) {
            traceInfo(
                `IPyKernel found previously in this environment ${getDisplayPath(kernelConnection.interpreter.path)}`
            );
            return true;
        }
        const installedPromise = this.installer
            .isInstalled(Product.ipykernel, kernelConnection.interpreter)
            .then((installed) => installed === true);
        void installedPromise.then((installed) => {
            if (installed) {
                void trackPackageInstalledIntoInterpreter(
                    this.memento,
                    Product.ipykernel,
                    kernelConnection.interpreter
                );
            }
        });
        return Promise.race([
            installedPromise,
            createPromiseFromCancellation({ token, defaultValue: false, cancelAction: 'resolve' })
        ]);
    }

    private async runInstaller(
        resource: Resource,
        interpreter: PythonEnvironment,
        ui: IDisplayOptions,
        cancelTokenSource: CancellationTokenSource
    ): Promise<KernelInterpreterDependencyResponse> {
        traceInfoIfCI(
            `Run Installer for ${getDisplayPath(resource)} ui.disableUI=${
                ui.disableUI
            }, cancelTokenSource.token.isCancellationRequested=${cancelTokenSource.token.isCancellationRequested}`
        );
        // If there's no UI, then cancel installation.
        if (ui.disableUI) {
            return KernelInterpreterDependencyResponse.uiHidden;
        }
        const [isModulePresent, isPipAvailableForNonConda] = await Promise.all([
            isModulePresentInEnvironment(this.memento, Product.ipykernel, interpreter),
            interpreter.envType === EnvironmentType.Conda
                ? undefined
                : await this.installer.isInstalled(Product.pip, interpreter)
        ]);
        if (cancelTokenSource.token.isCancellationRequested) {
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
        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: productNameForTelemetry,
            resourceType,
            resourceHash,
            pythonEnvType: interpreter.envType
        });
        const promptCancellationPromise = createPromiseFromCancellation({
            cancelAction: 'resolve',
            defaultValue: undefined,
            token: cancelTokenSource.token
        });
        const selectKernel = DataScience.selectKernel();
        // Due to a bug in our code, if we don't have a resource, don't display the option to change kernels.
        // https://github.com/microsoft/vscode-jupyter/issues/6135
        const options = resource ? [Common.install(), selectKernel] : [Common.install()];
        try {
            if (!this.isCodeSpace) {
                sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                    action: 'prompted',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreter.envType
                });
            }
            traceInfoIfCI(`Prompting user for install (this.isCodeSpace=${this.isCodeSpace}).`);
            const selection = this.isCodeSpace
                ? Common.install()
                : await Promise.race([
                      this.appShell.showInformationMessage(message, { modal: true }, ...options),
                      promptCancellationPromise
                  ]);
            if (cancelTokenSource.token.isCancellationRequested) {
                sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                    action: 'dismissed',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreter.envType
                });
                return KernelInterpreterDependencyResponse.cancel;
            }
            if (selection === selectKernel) {
                sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                    action: 'differentKernel',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreter.envType
                });
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            } else if (selection === Common.install()) {
                sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                    action: 'install',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreter.envType
                });
                const cancellationPromise = createPromiseFromCancellation({
                    cancelAction: 'resolve',
                    defaultValue: InstallerResponse.Cancelled,
                    token: cancelTokenSource.token
                });
                // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
                const response = await Promise.race([
                    this.installer.install(
                        Product.ipykernel,
                        interpreter,
                        cancelTokenSource,
                        isModulePresent === true,
                        isPipAvailableForNonConda === false
                    ),
                    cancellationPromise
                ]);
                if (response === InstallerResponse.Installed) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                        action: 'installed',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash,
                        pythonEnvType: interpreter.envType
                    });
                    return KernelInterpreterDependencyResponse.ok;
                } else if (response === InstallerResponse.Ignore) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                        action: 'failed',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash,
                        pythonEnvType: interpreter.envType
                    });
                    return KernelInterpreterDependencyResponse.failed; // Happens when errors in pip or conda.
                }
            }

            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action: 'dismissed',
                moduleName: productNameForTelemetry,
                resourceType,
                resourceHash,
                pythonEnvType: interpreter.envType
            });
            return KernelInterpreterDependencyResponse.cancel;
        } catch (ex) {
            traceError(`Failed to install ${productNameForTelemetry}`, ex);
            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action: 'error',
                moduleName: productNameForTelemetry,
                resourceType,
                resourceHash,
                pythonEnvType: interpreter.envType
            });
            throw ex;
        }
    }
}
