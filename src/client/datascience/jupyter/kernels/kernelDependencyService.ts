// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../common/application/types';
import { createPromiseFromCancellation, wrapCancellationTokens } from '../../../common/cancellation';
import {
    isModulePresentInEnvironment,
    isModulePresentInEnvironmentCache,
    trackPackageInstalledIntoInterpreter
} from '../../../common/installer/productInstaller';
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
import { ignoreLogging, TraceOptions } from '../../../logging/trace';
import { EnvironmentType, PythonEnvironment } from '../../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../telemetry/helpers';
import { getResourceType } from '../../common';
import { Telemetry } from '../../constants';
import { IpyKernelNotInstalledError } from '../../errors/ipyKernelNotInstalledError';
import { VSCodeNotebookController } from '../../notebook/vscodeNotebookController';
import { KernelProgressReporter } from '../../progress/kernelProgressReporter';
import {
    IDisplayOptions,
    IInteractiveWindowProvider,
    IKernelDependencyService,
    KernelInterpreterDependencyResponse
} from '../../types';
import { selectKernel } from './kernelSelector';
import {
    IKernelProvider,
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from './types';

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
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IServiceContainer) protected serviceContainer: IServiceContainer // @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider
    ) {}
    /**
     * Configures the python interpreter to ensure it can run a Jupyter Kernel by installing any missing dependencies.
     * If user opts not to install they can opt to select another interpreter.
     */
    @traceDecorators.verbose('Install Missing Dependencies', TraceOptions.ReturnValue)
    public async installMissingDependencies(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        ui: IDisplayOptions,
        @ignoreLogging() token: CancellationToken,
        ignoreCache?: boolean
    ): Promise<void> {
        traceInfo(`installMissingDependencies ${getDisplayPath(kernelConnection.interpreter?.path)}`);
        if (
            kernelConnection.kind === 'connectToLiveKernel' ||
            kernelConnection.kind === 'startUsingRemoteKernelSpec' ||
            kernelConnection.interpreter === undefined
        ) {
            return;
        }
        const result = await KernelProgressReporter.wrapAndReportProgress(
            resource,
            DataScience.validatingKernelDependencies(),
            () => this.areDependenciesInstalled(kernelConnection, token, ignoreCache)
        );
        if (result) {
            return;
        }
        if (token?.isCancellationRequested) {
            return;
        }

        // Cache the install run
        let promise = this.installPromises.get(kernelConnection.interpreter.path);
        if (!promise) {
            promise = KernelProgressReporter.wrapAndReportProgress(
                resource,
                DataScience.installingMissingDependencies(),
                () => this.runInstaller(resource, kernelConnection.interpreter!, ui, token)
            );
            this.installPromises.set(kernelConnection.interpreter.path, promise);
        }

        // Get the result of the question
        try {
            const result = await promise;
            if (token?.isCancellationRequested) {
                return;
            }
            await this.handleKernelDependencyResponse(result, kernelConnection, resource);
        } finally {
            // Don't need to cache anymore
            this.installPromises.delete(kernelConnection.interpreter.path);
        }
    }
    public async areDependenciesInstalled(
        kernelConnection: KernelConnectionMetadata,
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
            isModulePresentInEnvironmentCache(this.memento, Product.ipykernel, kernelConnection.interpreter)
        ) {
            traceInfo(
                `IPykernel found previously in this environment ${getDisplayPath(kernelConnection.interpreter.path)}`
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

    private async handleKernelDependencyResponse(
        response: KernelInterpreterDependencyResponse,
        kernelConnection: PythonKernelConnectionMetadata | LocalKernelSpecConnectionMetadata,
        resource: Resource
    ) {
        if (response === KernelInterpreterDependencyResponse.ok) {
            return;
        }
        const kernelProvider = this.serviceContainer.get<IKernelProvider>(IKernelProvider);
        const kernel = kernelProvider.kernels.find(
            (item) =>
                item.kernelConnectionMetadata === kernelConnection &&
                this.vscNotebook.activeNotebookEditor?.document &&
                this.vscNotebook.activeNotebookEditor?.document === item.notebookDocument &&
                (item.resourceUri || '')?.toString() === (resource || '').toString()
        );
        const firstQueuedCell = kernel && kernel.pendingCells.length > 0 ? kernel.pendingCells[0] : undefined;
        let anotherKernelSelected = false;
        if (response === KernelInterpreterDependencyResponse.selectDifferentKernel) {
            if (kernel) {
                // If user changes the kernel, then the next kernel must run the pending cells.
                // Store it for the other kernel to pick them up.
                VSCodeNotebookController.pendingCells.set(kernel.notebookDocument, kernel.pendingCells);
            }
            await selectKernel(
                resource,
                this.notebooks,
                this.serviceContainer.get(IInteractiveWindowProvider),
                this.commandManager
            );
            if (kernel) {
                VSCodeNotebookController.pendingCells.delete(kernel.notebookDocument);
                // If the previous kernel has been disposed (or disposing),
                // then this means the user selected a new kernel.
                anotherKernelSelected = kernel.disposed || kernel.disposing;
            }
        }
        // If selecting a new kernel, the current code paths don't allow us to just change a kernel on the fly.
        // We pass kernel connection information around, hence if there's a change we need to start all over again.
        // Throwing this exception will get the user to start again.
        const message = kernelConnection.interpreter?.displayName
            ? `${kernelConnection.interpreter?.displayName}:${getDisplayPath(kernelConnection.interpreter?.path)}`
            : getDisplayPath(kernelConnection.interpreter?.path);
        throw new IpyKernelNotInstalledError(
            DataScience.ipykernelNotInstalled().format(message),
            response,
            anotherKernelSelected,
            firstQueuedCell
        );
    }
    private async runInstaller(
        resource: Resource,
        interpreter: PythonEnvironment,
        ui: IDisplayOptions,
        token?: CancellationToken
    ): Promise<KernelInterpreterDependencyResponse> {
        // If there's no UI, then cancel installation.
        if (ui.disableUI) {
            return KernelInterpreterDependencyResponse.uiHidden;
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
            token
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
            const selection = this.isCodeSpace
                ? Common.install()
                : await Promise.race([
                      this.appShell.showInformationMessage(message, { modal: true }, ...options),
                      promptCancellationPromise
                  ]);
            if (installerToken.isCancellationRequested) {
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
