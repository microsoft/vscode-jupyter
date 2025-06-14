// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, Memento, Uri, env, window } from 'vscode';
import { raceCancellation } from '../platform/common/cancellation';
import { logger, debugDecorator, logValue } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IMemento, GLOBAL_MEMENTO, Resource, IDisplayOptions } from '../platform/common/types';
import { DataScience, Common } from '../platform/common/utils/localize';
import { IServiceContainer } from '../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../platform/pythonEnvironments/info';
import { Telemetry } from '../telemetry';
import { getTelemetrySafeHashedString } from '../platform/telemetry/helpers';
import {
    isModulePresentInEnvironmentCache,
    trackPackageInstalledIntoInterpreter
} from '../platform/interpreter/installer/productInstaller';
import { ProductNames } from '../platform/interpreter/installer/productNames';
import { IInstaller, Product, InstallerResponse } from '../platform/interpreter/installer/types';
import {
    IKernelDependencyService,
    isLocalConnection,
    KernelConnectionMetadata,
    KernelInterpreterDependencyResponse
} from './types';
import { noop } from '../platform/common/utils/misc';
import { getResourceType } from '../platform/common/utils';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';
import { IRawNotebookSupportedService } from './raw/types';
import { getComparisonKey } from '../platform/vscode-path/resources';
import { isModulePresentInEnvironment } from '../platform/interpreter/installer/productInstaller.node';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';
import { isPythonKernelConnection } from './helpers';
import { isCodeSpace } from '../platform/constants';
import { getEnvironmentType, getPythonEnvDisplayName } from '../platform/interpreter/helpers';

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
        @inject(IRawNotebookSupportedService) private readonly rawSupport: IRawNotebookSupportedService,
        @inject(IServiceContainer) protected serviceContainer: IServiceContainer // @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider
    ) {}
    /**
     * Configures the python interpreter to ensure it can run a Jupyter Kernel by installing any missing dependencies.
     * If user opts not to install they can opt to select another interpreter.
     */
    @debugDecorator('Install Missing Dependencies')
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
        if (
            !isLocalConnection(kernelConnection) ||
            !isPythonKernelConnection(kernelConnection) ||
            !kernelConnection.interpreter
        ) {
            return KernelInterpreterDependencyResponse.ok;
        }

        logger.info(
            `Check & install missing Kernel dependencies for ${getDisplayPath(
                kernelConnection.interpreter?.uri
            )}, ui.disabled=${ui.disableUI} for resource '${getDisplayPath(resource)}'`
        );
        const checkForPackages = async () => {
            const alreadyInstalled = ui.disableUI
                ? await this.areDependenciesInstalled(kernelConnection, token, ignoreCache)
                : await KernelProgressReporter.wrapAndReportProgress(
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
            const install = async () => {
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
            };
            promise = ui.disableUI
                ? install()
                : KernelProgressReporter.wrapAndReportProgress(
                      resource,
                      DataScience.installingMissingDependencies,
                      install
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
            logger.ci(`Failed to install kernel dependency`, ex);
            // Failure occurred
            dependencyResponse = KernelInterpreterDependencyResponse.failed;
        } finally {
            // Don't need to cache anymore
            this.installPromises.delete(key);
        }
        return dependencyResponse;
    }
    @debugDecorator('Are Dependencies Installed')
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
            logger.info(
                `IPyKernel found previously in this environment ${getDisplayPath(kernelConnection.interpreter.uri)}`
            );
            return true;
        }
        const installedPromise = this.installer
            .isInstalled(Product.ipykernel, kernelConnection.interpreter)
            .then((installed) => installed === true);
        installedPromise.then((installed) => {
            if (installed && kernelConnection.interpreter) {
                trackPackageInstalledIntoInterpreter(
                    this.memento,
                    Product.ipykernel,
                    kernelConnection.interpreter
                ).catch(noop);
            }
        }, noop);
        return raceCancellation(token, false, installedPromise);
    }

    private async runInstaller(
        resource: Resource,
        interpreter: PythonEnvironment,
        ui: IDisplayOptions,
        cancelTokenSource: CancellationTokenSource,
        cannotChangeKernels?: boolean,
        installWithoutPrompting?: boolean
    ): Promise<KernelInterpreterDependencyResponse> {
        logger.ci(
            `Run Installer for ${getDisplayPath(resource)} ui.disableUI=${
                ui.disableUI
            }, cancelTokenSource.token.isCancellationRequested=${cancelTokenSource.token.isCancellationRequested}`
        );
        // If there's no UI, then cancel installation.
        if (ui.disableUI && !installWithoutPrompting) {
            return KernelInterpreterDependencyResponse.uiHidden;
        }
        const interpreterType = getEnvironmentType(interpreter);
        const [isModulePresent, isPipAvailableForNonConda] = await Promise.all([
            isModulePresentInEnvironment(this.memento, Product.ipykernel, interpreter),
            interpreterType === EnvironmentType.Conda
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
            getPythonEnvDisplayName(interpreter) || interpreter.uri.fsPath,
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
            pythonEnvType: interpreterType
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
            if (!isCodeSpace() || !installWithoutPrompting) {
                sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                    action: 'prompted',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreterType
                });
            }
            let selection;
            do {
                selection =
                    isCodeSpace() || installWithoutPrompting
                        ? installOption
                        : await raceCancellation(
                              cancelTokenSource.token,
                              window.showInformationMessage(message, { modal: true }, ...options)
                          );

                if (selection === moreInfoOption) {
                    sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                        action: 'moreInfo',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash,
                        pythonEnvType: interpreterType
                    });

                    // Link to our wiki page on jupyter kernels + ipykernel
                    // https://github.com/microsoft/vscode-jupyter/wiki/Jupyter-Kernels-and-the-Jupyter-Extension#python-extension-and-ipykernel
                    void env.openExternal(Uri.parse('https://aka.ms/AAhi594'));
                }
                // "More Info" isn't a full valid response here, so reprompt after showing it
            } while (selection === moreInfoOption);
            if (cancelTokenSource.token.isCancellationRequested) {
                sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                    action: 'dismissed',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreterType
                });
                return KernelInterpreterDependencyResponse.cancel;
            }
            if (selection === selectKernelOption) {
                sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                    action: 'differentKernel',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreterType
                });
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            } else if (selection === installOption) {
                sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                    action: 'install',
                    moduleName: productNameForTelemetry,
                    resourceType,
                    resourceHash,
                    pythonEnvType: interpreterType
                });
                // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
                const response = await raceCancellation(
                    cancelTokenSource.token,
                    InstallerResponse.Cancelled,
                    this.installer.install(
                        Product.ipykernel,
                        interpreter,
                        cancelTokenSource,
                        isModulePresent === true,
                        isPipAvailableForNonConda === false,
                        ui.disableUI === true
                    )
                );
                if (response === InstallerResponse.Installed) {
                    sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                        action: 'installed',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash,
                        pythonEnvType: interpreterType
                    });
                    return KernelInterpreterDependencyResponse.ok;
                } else if (response === InstallerResponse.Ignore) {
                    sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                        action: 'failed',
                        moduleName: productNameForTelemetry,
                        resourceType,
                        resourceHash,
                        pythonEnvType: interpreterType
                    });
                    return KernelInterpreterDependencyResponse.failed; // Happens when errors in pip or conda.
                }
            }
            sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                action: 'dismissed',
                moduleName: productNameForTelemetry,
                resourceType,
                resourceHash,
                pythonEnvType: interpreterType
            });
            return KernelInterpreterDependencyResponse.cancel;
        } catch (ex) {
            logger.error(`Failed to install ${productNameForTelemetry}`, ex);
            sendKernelTelemetryEvent(resource, Telemetry.PythonModuleInstall, undefined, {
                action: 'error',
                moduleName: productNameForTelemetry,
                resourceType,
                resourceHash,
                pythonEnvType: interpreterType
            });
            throw ex;
        }
    }
}
