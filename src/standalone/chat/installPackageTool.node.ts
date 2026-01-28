// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import {
    ensureKernelSelectedAndStarted,
    hasKernelStartedOrIsStarting,
    installPackageThroughEnvsExtension
} from './helper.node';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { IInstallationChannelManager } from '../../platform/interpreter/installer/types';
import { isPythonKernelConnection } from '../../kernels/helpers';
import { RestartKernelTool } from './restartKernelTool.node';
import { BaseTool, IBaseToolParams } from './helper';
import { WrappedError } from '../../platform/errors/types';

export class InstallPackagesTool extends BaseTool<IInstallPackageParams> {
    public static toolName = 'notebook_install_packages';
    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration,
        private readonly installationManager: IInstallationChannelManager
    ) {
        super(InstallPackagesTool.toolName);
    }

    async invokeImpl(
        options: vscode.LanguageModelToolInvocationOptions<IInstallPackageParams>,
        notebook: vscode.NotebookDocument,
        token: vscode.CancellationToken
    ) {
        const { packageList } = options.input;

        if (!packageList || packageList.length === 0) {
            throw new WrappedError('filePath and package list are required parameters.', undefined, 'emptyPackageList');
        }

        const kernel = await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, token);
        if (!kernel) {
            throw new WrappedError(
                `No active kernel for notebook ${notebook.uri}, A kernel needs to be selected.`,
                undefined,
                'noActiveKernel'
            );
        }

        let success: boolean = false;
        const kernelUri = kernel.kernelConnectionMetadata.interpreter?.uri;
        if (
            kernelUri &&
            isPythonKernelConnection(kernel.kernelConnectionMetadata) &&
            (kernel.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                kernel.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter')
        ) {
            success = await installPackageThroughEnvsExtension(kernelUri, packageList);
        }

        if (!success && kernel.kernelConnectionMetadata.interpreter) {
            const cancellationTokenSource = new vscode.CancellationTokenSource();
            token.onCancellationRequested(() => cancellationTokenSource.cancel());
            const installers = await this.installationManager.getInstallationChannels(
                kernel.kernelConnectionMetadata.interpreter
            );
            if (installers.length > 0) {
                const installer = installers[0];
                for (const packageName of packageList) {
                    await installer.installModule(
                        packageName,
                        kernel.kernelConnectionMetadata.interpreter,
                        cancellationTokenSource,
                        undefined,
                        true
                    );
                }
                success = true;
            }
        }

        if (!success) {
            const message = `Failed to install one or more packages: ${packageList.join(', ')}.`;
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)]);
        }

        const restartOptionsInput = { ...options.input, reason: 'Packages installed' };
        const restartOptions = { ...options, input: restartOptionsInput };

        try {
            await vscode.lm.invokeTool(RestartKernelTool.toolName, restartOptions);
        } catch (ex) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Installation finished, but the kernel was not restarted because ${
                        ex.name === 'Canceled' ? 'the user chose not to' : `an error occurred: ${ex.message}`
                    }.`
                )
            ]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                'Installation finished successfully. The kernel has been restarted, so any previously executed cells will need to be re-run.'
            )
        ]);
    }

    async prepareInvocationImpl(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IInstallPackageParams>,
        notebook: vscode.NotebookDocument,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const controller = this.controllerRegistration.getSelected(notebook);
        const kernel = this.kernelProvider.get(notebook);
        if (controller && kernel && hasKernelStartedOrIsStarting(kernel)) {
            return {
                confirmationMessages: {
                    title: vscode.l10n.t(`Install packages?`),
                    message: vscode.l10n.t('Installing packages: {0}', options.input.packageList.join(', '))
                },
                invocationMessage: vscode.l10n.t('Installing packages: {0}', options.input.packageList.join(', '))
            };
        } else {
            return {
                confirmationMessages: {
                    title: vscode.l10n.t(`Start Kernel and Install packages?`),
                    message: vscode.l10n.t(
                        'The notebook kernel needs to be started before installing packages: {0}',
                        options.input.packageList.join(', ')
                    )
                },
                invocationMessage: vscode.l10n.t(
                    'Starting kernel and installing packages: {0}',
                    options.input.packageList.join(', ')
                )
            };
        }
    }
}

export interface IInstallPackageParams extends IBaseToolParams {
    packageList: string[];
}
