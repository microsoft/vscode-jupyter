// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernel, IKernelProvider } from '../../kernels/types';
import {
    ensureKernelSelectedAndStarted,
    getPackagesFromEnvsExtension,
    hasKernelStartedOrIsStarting,
    IBaseToolParams,
    packageDefinition,
    resolveNotebookFromFilePath,
    sendPipListRequest
} from './helper.node';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { isPythonKernelConnection } from '../../kernels/helpers';
import { isKernelLaunchedViaLocalPythonIPyKernel } from '../../kernels/helpers.node';

export class ListPackageTool implements vscode.LanguageModelTool<IBaseToolParams> {
    public static toolName = 'notebook_list_packages';

    public get name() {
        return ListPackageTool.toolName;
    }
    public get description() {
        return 'Lists all installed packages in the active kernel of a notebook.';
    }

    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration
    ) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<IBaseToolParams>, token: vscode.CancellationToken) {
        const { filePath } = options.input;

        if (!filePath) {
            throw new Error('notebookUri is a required parameter.');
        }

        const notebook = await resolveNotebookFromFilePath(filePath);
        const kernel = await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, token);
        if (!kernel) {
            throw new Error(`No active kernel for notebook ${filePath}, A kernel needs to be selected.`);
        }
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            throw new Error(`The selected Kernel is not a Python Kernel and this tool only supports Python Kernels.`);
        }

        const packagesMessage = await getPythonPackagesInKernel(kernel);

        if (!packagesMessage) {
            throw new Error(`Unable to list packages for notebook ${filePath}.`);
        }

        return new vscode.LanguageModelToolResult([packagesMessage]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IBaseToolParams>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);

        const controller = this.controllerRegistration.getSelected(notebook);
        const kernel = this.kernelProvider.get(notebook);
        if (controller && kernel && hasKernelStartedOrIsStarting(kernel)) {
            return { invocationMessage: vscode.l10n.t('Listing packages') };
        } else {
            return {
                confirmationMessages: {
                    title: vscode.l10n.t(`Start Kernel and List Packages?`),
                    message: vscode.l10n.t('The notebook kernel needs to be started before listing packages')
                },
                invocationMessage: vscode.l10n.t('Starting kernel and listing packages')
            };
        }
    }
}

export async function getPythonPackagesInKernel(kernel: IKernel): Promise<vscode.LanguageModelTextPart | undefined> {
    if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
        throw new Error(`The selected Kernel is not a Python Kernel and this tool only supports Python Kernels.`);
    }

    const kernelUri = kernel.kernelConnectionMetadata.interpreter?.uri;
    let packages: packageDefinition[] | undefined = [];
    if (kernelUri && isKernelLaunchedViaLocalPythonIPyKernel(kernel.kernelConnectionMetadata)) {
        packages = await getPackagesFromEnvsExtension(kernelUri);
    }

    if (!packages) {
        // TODO: There is an IInstaller service available, but currently only lists info for a single package.
        // It may also depend on the environment extension?
        const token = new vscode.CancellationTokenSource();
        try {
            packages = await sendPipListRequest(kernel, token.token);
        } finally {
            token.dispose();
        }
    }

    if (packages) {
        const contentString = packages.map((pkg) => `${pkg.name}==${pkg.version}`).join(', ');
        const finalMessageString = `Packages installed in notebook: ${contentString}`;
        return new vscode.LanguageModelTextPart(finalMessageString);
    }
}
