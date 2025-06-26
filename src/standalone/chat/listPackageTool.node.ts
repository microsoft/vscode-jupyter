// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernel, IKernelProvider } from '../../kernels/types';
import {
    ensureKernelSelectedAndStarted,
    getPackagesFromEnvsExtension,
    hasKernelStartedOrIsStarting,
    packageDefinition,
    sendPipListRequest
} from './helper.node';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { isPythonKernelConnection } from '../../kernels/helpers';
import { isKernelLaunchedViaLocalPythonIPyKernel } from '../../kernels/helpers.node';
import { BaseTool, IBaseToolParams, TelemetrySafeError } from './helper';

export class ListPackageTool extends BaseTool<IBaseToolParams> {
    public static toolName = 'notebook_list_packages';
    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration
    ) {
        super(ListPackageTool.toolName);
    }

    async invokeImpl(
        _options: vscode.LanguageModelToolInvocationOptions<IBaseToolParams>,
        notebook: vscode.NotebookDocument,
        token: vscode.CancellationToken
    ) {
        const kernel = await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, token);
        if (!kernel) {
            throw new TelemetrySafeError(
                `No active kernel for notebook ${notebook.uri}, A kernel needs to be selected.`,
                'noActiveKernel'
            );
        }
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            throw new TelemetrySafeError(
                `The selected Kernel is not a Python Kernel and this tool only supports Python Kernels.`,
                'nonPythonKernelSelected'
            );
        }

        const packagesMessage = await getPythonPackagesInKernel(kernel);

        if (!packagesMessage) {
            throw new TelemetrySafeError(
                `Unable to list packages for notebook ${notebook.uri}.`,
                'failedToListPackages'
            );
        }

        return new vscode.LanguageModelToolResult([packagesMessage]);
    }

    async prepareInvocationImpl(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<IBaseToolParams>,
        notebook: vscode.NotebookDocument,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
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
        throw new TelemetrySafeError(
            `The selected Kernel is not a Python Kernel and this tool only supports Python Kernels.`,
            'nonPythonKernelSelected'
        );
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
