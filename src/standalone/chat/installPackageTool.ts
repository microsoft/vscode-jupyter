// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { ensureKernelSelectedAndStarted, installPackageThroughEnvsExtension, sendPipInstallRequest } from './helper';
import { IControllerRegistration } from '../../notebooks/controllers/types';

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
        private readonly controllerRegistration: IControllerRegistration
    ) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IInstallPackageParams>,
        token: vscode.CancellationToken
    ) {
        const { filePath, packageList } = options.input;

        if (!filePath || !packageList || packageList.length === 0) {
            throw new Error('filePath and package list are required parameters.');
        }

        // TODO: handle other schemas
        const uri = vscode.Uri.file(filePath);
        let notebook = vscode.workspace.notebookDocuments.find((n) => n.uri.toString() === uri.toString());
        if (!notebook) {
            notebook = await vscode.workspace.openNotebookDocument(uri);
            if (!notebook) {
                throw new Error(`Unable to find notebook at ${filePath}.`);
            }
        }

        const kernel = await ensureKernelSelectedAndStarted(
            notebook,
            this.controllerRegistration,
            this.kernelProvider,
            token
        );

        if (!kernel) {
            throw new Error(`No active kernel for notebook ${filePath}, A kernel needs to be selected.`);
        }

        let success: boolean = false;
        let output = '';
        const kernelUri = kernel.kernelConnectionMetadata.interpreter?.uri;
        if (
            kernelUri &&
            (kernel.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                kernel.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter')
        ) {
            success = await installPackageThroughEnvsExtension(kernelUri, packageList);
        }

        if (!success) {
            // TODO: There is an IInstaller service available, but currently only for a set list of packages.
            const result = await sendPipInstallRequest(kernel, packageList, token);
            output = ` Output: ${String(result)}`;
            if (output.length > 200) {
                output = output.substring(0, 200) + '...';
            }
        }
        const finalMessageString = `Installation finished.${output}`;
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(finalMessageString)]);
    }

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IInstallPackageParams>,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        const filePath = options.input.filePath;
        const uri = vscode.Uri.file(filePath);
        const notebook = vscode.workspace.notebookDocuments.find((n) => n.uri.toString() === uri.toString());
        const controller = notebook ? this.controllerRegistration.getSelected(notebook) : undefined;
        const kernel = notebook ? this.kernelProvider.get(notebook) : undefined;
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
