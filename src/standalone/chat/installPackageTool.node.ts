// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { installPackageThroughEnvsExtension, resolveNotebookFromFilePath } from './helper';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { IInstallationChannelManager } from '../../platform/interpreter/installer/types';
import { isPythonKernelConnection } from '../../kernels/helpers';
import { ConfigurePythonNotebookTool } from './configureNotebook.python.node';

export class InstallPackagesTool implements vscode.LanguageModelTool<IInstallPackageParams> {
    public static toolName = 'notebook_install_packages';

    public get name() {
        return InstallPackagesTool.toolName;
    }
    public get description() {
        return 'Installs a package into the active kernel of a notebook.';
    }

    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration,
        private readonly installationManager: IInstallationChannelManager
    ) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IInstallPackageParams>,
        token: vscode.CancellationToken
    ) {
        const { filePath, packageList } = options.input;

        if (!filePath || !packageList || packageList.length === 0) {
            throw new Error('filePath and package list are required parameters.');
        }

        const notebook = await resolveNotebookFromFilePath(filePath);
        await new ConfigurePythonNotebookTool(this.kernelProvider, this.controllerRegistration).invoke(notebook, token);
        const kernel = this.kernelProvider.get(notebook);
        if (!kernel) {
            throw new Error(`No active kernel for notebook ${filePath}, A kernel needs to be selected.`);
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
                        cancellationTokenSource
                    );
                }
                success = true;
            }
        }

        if (!success) {
            const message = `Failed to install one or more packages: ${packageList.join(', ')}.`;
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Installation finished successfully.')
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IInstallPackageParams>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        const controller = this.controllerRegistration.getSelected(notebook);
        const kernel = this.kernelProvider.get(notebook);
        if (!controller || !kernel || !kernel.startedAtLeastOnce) {
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

        const packageInstallationPrompt = vscode.l10n.t(
            'Installing packages into notebook kernel: {0}',
            options.input.packageList.join(', ')
        );
        const confirmationMessages = {
            title: vscode.l10n.t(`Install Packages`),
            message: packageInstallationPrompt
        };

        return {
            confirmationMessages,
            invocationMessage: packageInstallationPrompt
        };
    }
}

export interface IInstallPackageParams {
    filePath: string;
    packageList: string[];
}
