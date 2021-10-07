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
import { noop } from '../../../common/utils/misc';
import { IServiceContainer } from '../../../ioc/types';
import { TraceOptions } from '../../../logging/trace';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { getTelemetrySafeHashedString } from '../../../telemetry/helpers';
import { getResourceType } from '../../common';
import { Telemetry } from '../../constants';
import { getActiveInteractiveWindow } from '../../interactive-window/helpers';
import { IpyKernelNotInstalledError } from '../../kernel-launcher/types';
import { IInteractiveWindowProvider, IKernelDependencyService, KernelInterpreterDependencyResponse } from '../../types';

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
        traceInfo(`installMissingDependencies ${interpreter.path}`);
        if (await this.areDependenciesInstalled(interpreter, token)) {
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
            await this.handleKernelDependencyResponse(result, interpreter, resource);
        } finally {
            // Don't need to cache anymore
            this.installPromises.delete(interpreter.path);
        }
    }
    public areDependenciesInstalled(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean> {
        return this.installer.isInstalled(Product.ipykernel, interpreter).then((installed) => installed === true);
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
            const notebook =
                getResourceType(resource) === 'notebook'
                    ? this.notebooks.notebookDocuments.find((item) => item.uri.toString() === resource?.toString())
                    : undefined;
            const notebookEditor =
                notebook && this.notebooks.activeNotebookEditor?.document === notebook
                    ? this.notebooks.activeNotebookEditor
                    : undefined;
            const targetNotebookEditor =
                notebookEditor ||
                getActiveInteractiveWindow(this.serviceContainer.get(IInteractiveWindowProvider))?.notebookEditor;
            if (targetNotebookEditor) {
                await this.commandManager
                    .executeCommand('notebook.selectKernel', { notebookEditor: targetNotebookEditor })
                    .then(noop, noop);
            } else {
                traceError(`Unable to select kernel as the Notebook document could not be identified`);
            }
        }
        throw new IpyKernelNotInstalledError(
            DataScience.ipykernelNotInstalled().format(
                `${interpreter.displayName || interpreter.path}:${interpreter.path}`
            ),
            response
        );
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
        const isModulePresent = await isModulePresentInEnvironment(this.memento, Product.ipykernel, interpreter);
        if (installerToken.isCancellationRequested) {
            return KernelInterpreterDependencyResponse.cancel;
        }
        const messageFormat = isModulePresent
            ? DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreterAndRequiresUpdate()
            : DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter();
        const message = messageFormat.format(
            interpreter.displayName || interpreter.path,
            ProductNames.get(Product.ipykernel)!
        );
        const ipykernelProductName = ProductNames.get(Product.ipykernel)!;
        const resourceType = resource ? getResourceType(resource) : undefined;
        const resourceHash = resource ? getTelemetrySafeHashedString(resource.toString()) : undefined;
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ipykernelProductName,
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
                    moduleName: ipykernelProductName,
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
                    moduleName: ipykernelProductName,
                    resourceType,
                    resourceHash
                });
                return KernelInterpreterDependencyResponse.cancel;
            }

            if (selection === selectKernel) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'differentKernel',
                    moduleName: ipykernelProductName,
                    resourceType,
                    resourceHash
                });
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            } else if (selection === installPrompt) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'install',
                    moduleName: ipykernelProductName,
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
                    this.installer.install(Product.ipykernel, interpreter, installerToken, isModulePresent === true),
                    cancellationPromise
                ]);
                if (response === InstallerResponse.Installed) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                        action: 'installed',
                        moduleName: ipykernelProductName,
                        resourceType,
                        resourceHash
                    });
                    return KernelInterpreterDependencyResponse.ok;
                } else if (response === InstallerResponse.Ignore) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                        action: 'failed',
                        moduleName: ipykernelProductName,
                        resourceType,
                        resourceHash
                    });
                    return KernelInterpreterDependencyResponse.failed; // Happens when errors in pip or conda.
                }
            }

            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action: 'dismissed',
                moduleName: ipykernelProductName,
                resourceType,
                resourceHash
            });
            return KernelInterpreterDependencyResponse.cancel;
        } catch (ex) {
            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action: 'error',
                moduleName: ipykernelProductName,
                resourceType,
                resourceHash
            });
            throw ex;
        }
    }
}
