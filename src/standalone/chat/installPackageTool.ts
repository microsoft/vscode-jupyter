// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { injectable } from 'inversify';
import { installPackageThroughEnvsExtension, sendPipInstallRequest } from './helper';

@injectable()
export class InstallPackagesTool implements vscode.LanguageModelTool<IInstallPackageParams> {
    public static toolName = 'notebook_install_packages_tool';

    public get name() {
        return InstallPackagesTool.toolName;
    }
    public get description() {
        return 'Installs a package into the active kernel of a notebook.';
    }

    constructor(private readonly kernelProvider: IKernelProvider) {}

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
        const notebook = vscode.workspace.notebookDocuments.find((n) => n.uri.toString() === uri.toString());
        if (!notebook) {
            throw new Error(`Notebook ${filePath} not found.`);
        }
        const kernel = this.kernelProvider.get(notebook);
        if (!kernel) {
            throw new Error(`No active kernel for notebook ${filePath}, A kernel needs to be selected.`);
        }

        let success: boolean = false;
        const kernelUri = kernel.kernelConnectionMetadata.interpreter?.uri;
        if (
            kernelUri &&
            (kernel.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                kernel.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter')
        ) {
            if (await installPackageThroughEnvsExtension(kernelUri, packageList)) {
                const finalMessageString = `Installation finished, you may need to restart the kernel for the changes to take effect.`;
                return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(finalMessageString)]);
            }
        }

        if (!success) {
            // TODO: There is an IInstaller service available, but currently only for a set list of packages.
            const result = await sendPipInstallRequest(kernel, packageList, token);
            let message = String(result);
            if (message.length > 200) {
                message = message.substring(0, 200) + '...';
            }
            const finalMessageString = `Installation finished. If the installation was successful and importing still doesn't succeed, you may need to restart the kernel first. Output: ${message}`;
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(finalMessageString)]);
        }
    }

    prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<IInstallPackageParams>,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        return undefined;
    }
}

export interface IInstallPackageParams {
    filePath: string;
    packageList: string[];
}
