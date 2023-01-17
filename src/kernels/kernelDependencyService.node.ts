// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, Memento } from 'vscode';
import { IApplicationShell } from '../platform/common/application/types';
import { createPromiseFromCancellation } from '../platform/common/cancellation';
import { traceInfo, traceError, traceInfoIfCI, traceDecoratorVerbose, logValue } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IMemento, GLOBAL_MEMENTO, IsCodeSpace, Resource, IDisplayOptions } from '../platform/common/types';
import { DataScience, Common } from '../platform/common/utils/localize';
import { IServiceContainer } from '../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../platform/pythonEnvironments/info';
import { Telemetry } from '../telemetry';
import { getTelemetrySafeHashedString } from '../platform/telemetry/helpers';
import { isModulePresentInEnvironmentCache, trackPackageInstalledIntoInterpreter } from './installer/productInstaller';
import { ProductNames } from './installer/productNames';
import { IInstaller, Product, InstallerResponse } from './installer/types';
import { IKernelDependencyService, KernelConnectionMetadata, KernelInterpreterDependencyResponse } from './types';
import { noop } from '../platform/common/utils/misc';
import { getResourceType } from '../platform/common/utils';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';
import { IRawNotebookSupportedService } from './raw/types';
import { getComparisonKey } from '../platform/vscode-path/resources';
import { isModulePresentInEnvironment } from './installer/productInstaller.node';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';

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
    @traceDecoratorVerbose('Install Missing Dependencies')
    public async installMissingDependencies({
        resource,
        kernelConnection,
        ui,
        token,
        ignoreCache,
        cannotChangeKernels,
        installWithoutPrompting
    }: {
        resource: Resource;
        kernelConnection: KernelConnectionMetadata;
        ui: IDisplayOptions;
        token: CancellationToken;
        ignoreCache?: boolean;
        cannotChangeKernels?: boolean;
        installWithoutPrompting?: boolean;
    }): Promise<KernelInterpreterDependencyResponse> {
        traceInfo(
            `installMissingDependencies ${
                kernelConnection.interpreter?.uri ? getDisplayPath(kernelConnection.interpreter?.uri) : ''
            }, ui.disabled=${ui.disableUI} for resource '${getDisplayPath(resource)}'`
        );
        if (
            kernelConnection.kind === 'connectToLiveRemoteKernel' ||
            kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
            kernelConnection.interpreter === undefined
        ) {
            return KernelInterpreterDependencyResponse.ok;
        }

        const checkForPackages = async () => {
            const alreadyInstalled = await KernelProgressReporter.wrapAndReportProgress(
                resource,
                DataScience.validatingKernelDependencies,
                () => this.areDependenciesInstalled(kernelConnection, token, ignoreCache)
            );
            if (alreadyInstalled) {
                return KernelInterpreterDependencyResponse.ok;
            }
            if (token?.isCancellationRequested) {
                return KernelInterpreterDependencyResponse.cancel;
            }
        };

        if (!installWithoutPrompting) {
            const result = await checkForPackages();
            if (
                result === KernelInterpreterDependencyResponse.ok ||
                result === KernelInterpreterDependencyResponse.cancel
            ) {
                return result;
            }
        }

        // Cache the install run
        const key = getComparisonKey(kernelConnection.interpreter.uri);
        let promise = this.installPromises.get(key);
        let cancelTokenSource: CancellationTokenSource | undefined;
        if (!promise) {
            const cancelTokenSource = new CancellationTokenSource();
            const disposable = token.onCancellationRequested(() => {
                cancelTokenSource.cancel();
                disposable.dispose();
            });
            promise = KernelProgressReporter.wrapAndReportProgress(
                resource,
                DataScience.installingMissingDependencies,
                async () => {
                    if (installWithoutPrompting) {
                        const result = await checkForPackages();
                        if (
                            result === KernelInterpreterDependencyResponse.ok ||
                            result === KernelInterpreterDependencyResponse.cancel
                        ) {
                            return result;
                        }
                    }
                    return this.runInstaller(
                        resource,
                        kernelConnection.interpreter!,
                        ui,
                        cancelTokenSource,
                        cannotChangeKernels,
                        installWithoutPrompting
                    );
                }
            );
            promise
                .finally(() => {
                    disposable.dispose();
                    cancelTokenSource.dispose();
                })
                .catch(noop);
            this.installPromises.set(key, promise);
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
            this.installPromises.delete(key);
        }
        return dependencyResponse;
    }
    @traceDecoratorVerbose('Are Dependencies Installed')
    public async areDependenciesInstalled(
        @logValue<KernelConnectionMetadata>('id') kernelConnection: KernelConnectionMetadata,
        token?: CancellationToken,
        ignoreCache?: boolean
    ): Promise<boolean> {
        if (
            kernelConnection.kind === 'connectToLiveRemoteKernel' ||
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
            (await isModulePresentInEnvironmentCache(this.memento, Product.ipykernel, kernelConnection.interpreter))
        ) {
            traceInfo(
                `IPyKernel found previously in this environment ${getDisplayPath(kernelConnection.interpreter.uri)}`
            );
            return true;
        }
        const installedPromise = this.installer
            .isInstalled(Product.ipykernel, kernelConnection.interpreter)
            .then((installed) => installed === true);
        installedPromise.then((installed) => {
            if (installed) {
                trackPackageInstalledIntoInterpreter(
                    this.memento,
                    Product.ipykernel,
                    kernelConnection.interpreter
                ).catch(noop);
            }
        }, noop);
        return Promise.race([
            installedPromise,
            createPromiseFromCancellation({ token, defaultValue: false, cancelAction: 'resolve' })
        ]);
    }

    private async runInstaller(
        resource: Resource,
        interpreter: PythonEnvironment,
        ui: IDisplayOptions,
        cancelTokenSource: CancellationTokenSource,
        cannotChangeKernels?: boolean,
        installWithoutPrompting?: boolean
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
            ? DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreterAndRequiresUpdate
            : DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter;
        const products = isPipAvailableForNonConda === false ? [Product.ipykernel, Product.pip] : [Product.ipykernel];
        const message = messageFormat(
            interpreter.displayName || interpreter.uri.fsPath,
            products.map((product) => ProductNames.get(product)!).join(` ${Common.and} `)
        );
        const productNameForTelemetry = products.map((product) => ProductNames.get(product)!).join(', ');
        const resourceType = resource ? getResourceType(resource) : undefined;
        const resourceHash = resource ? await getTelemetrySafeHashedString(resource.toString()) : undefined;
        sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
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

        // Build our set of prompt actions
        const installOption = Common.install;
        const selectKernelOption = DataScience.selectKernel;
        const moreInfoOption = Common.moreInfo;
        const options = [installOption];
        if (resource && !cannotChangeKernels) {
            // Due to a bug in our code, if we don't have a resource, don't display the option to change kernels.
            // https://github.com/microsoft/vscode-jupyter/issues/6135
            options.push(selectKernelOption);
        }
        options.push(moreInfoOption);

        try {
            if (!this.isCodeSpace || !installWithoutPrompting) {
                sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                    action: 'prompted',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreter.envType
                });
            }
            traceInfoIfCI(`Prompting user for install (this.isCodeSpace=${this.isCodeSpace}).`);
            let selection;
            do {
                selection =
                    this.isCodeSpace || installWithoutPrompting
                        ? installOption
                        : await Promise.race([
                              this.appShell.showInformationMessage(message, { modal: true }, ...options),
                              promptCancellationPromise
                          ]);

                if (selection === moreInfoOption) {
                    sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                        action: 'moreInfo',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash,
                        pythonEnvType: interpreter.envType
                    });

                    // Link to our wiki page on jupyter kernels + ipykernel
                    // https://github.com/microsoft/vscode-jupyter/wiki/Jupyter-Kernels-and-the-Jupyter-Extension#python-extension-and-ipykernel
                    this.appShell.openUrl('https://aka.ms/AAhi594');
                }
                // "More Info" isn't a full valid response here, so reprompt after showing it
            } while (selection === moreInfoOption);
            if (cancelTokenSource.token.isCancellationRequested) {
                sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                    action: 'dismissed',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreter.envType
                });
                return KernelInterpreterDependencyResponse.cancel;
            }
            if (selection === selectKernelOption) {
                sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                    action: 'differentKernel',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreter.envType
                });
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            } else if (selection === installOption) {
                sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
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
                    sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                        action: 'installed',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash,
                        pythonEnvType: interpreter.envType
                    });
                    return KernelInterpreterDependencyResponse.ok;
                } else if (response === InstallerResponse.Ignore) {
                    sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                        action: 'failed',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash,
                        pythonEnvType: interpreter.envType
                    });
                    return KernelInterpreterDependencyResponse.failed; // Happens when errors in pip or conda.
                }
            }
            sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                action: 'dismissed',
                moduleName: productNameForTelemetry,
                resourceType,
                resourceHash,
                pythonEnvType: interpreter.envType
            });
            return KernelInterpreterDependencyResponse.cancel;
        } catch (ex) {
            traceError(`Failed to install ${productNameForTelemetry}`, ex);
            sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
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
