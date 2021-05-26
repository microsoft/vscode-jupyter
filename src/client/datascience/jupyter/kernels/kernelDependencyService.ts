// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento } from 'vscode';
import { IApplicationShell, ICommandManager } from '../../../common/application/types';
import { createPromiseFromCancellation, wrapCancellationTokens } from '../../../common/cancellation';
import { UseVSCodeNotebookEditorApi } from '../../../common/constants';
import { isModulePresentInEnvironment } from '../../../common/installer/productInstaller';
import { ProductNames } from '../../../common/installer/productNames';
import { traceDecorators, traceInfo } from '../../../common/logger';
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
import { TraceOptions } from '../../../logging/trace';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../../telemetry';
import { getResourceType } from '../../common';
import { Commands, Telemetry } from '../../constants';
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
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IsCodeSpace) private readonly isCodeSpace: boolean,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(UseVSCodeNotebookEditorApi) private readonly useNativeNb: boolean
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
            promise = this.runInstaller(interpreter, token, disableUI);
            this.installPromises.set(interpreter.path, promise);
        }

        // Get the result of the question
        try {
            const result = await promise;
            this.handleKernelDependencyResponse(resource, result, interpreter);
        } finally {
            // Don't need to cache anymore
            this.installPromises.delete(interpreter.path);
        }
    }
    public areDependenciesInstalled(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean> {
        return this.installer.isInstalled(Product.ipykernel, interpreter).then((installed) => installed === true);
    }
    private handleKernelDependencyResponse(
        resource: Resource,
        response: KernelInterpreterDependencyResponse,
        interpreter: PythonEnvironment
    ) {
        if (response === KernelInterpreterDependencyResponse.ok) {
            return;
        }
        if (response === KernelInterpreterDependencyResponse.selectDifferentKernel) {
            const cmd =
                getResourceType(resource) === 'notebook' && this.useNativeNb
                    ? 'notebook.selectKernel'
                    : Commands.SwitchJupyterKernel;
            this.commandManager.executeCommand(cmd).then(noop, noop);
        }
        throw new IpyKernelNotInstalledError(
            DataScience.ipykernelNotInstalled().format(
                `${interpreter.displayName || interpreter.path}:${interpreter.path}`
            ),
            response
        );
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
        const installerToken = wrapCancellationTokens(token);
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
        const promptCancellationPromise = createPromiseFromCancellation({
            cancelAction: 'resolve',
            defaultValue: undefined,
            token
        });
        const installPrompt = isModulePresent ? Common.reInstall() : Common.install();
        const selectKernel = DataScience.selectKernel();
        const selection = this.isCodeSpace
            ? installPrompt
            : await Promise.race([
                  this.appShell.showErrorMessage(message, { modal: true }, installPrompt, selectKernel),
                  promptCancellationPromise
              ]);
        if (installerToken.isCancellationRequested) {
            return KernelInterpreterDependencyResponse.cancel;
        }

        if (selection === selectKernel) {
            return KernelInterpreterDependencyResponse.selectDifferentKernel;
        } else if (selection === installPrompt) {
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
                return KernelInterpreterDependencyResponse.ok;
            } else if (response === InstallerResponse.Ignore) {
                return KernelInterpreterDependencyResponse.failed; // Happens when errors in pip or conda.
            }
        }
        return KernelInterpreterDependencyResponse.cancel;
    }
}
