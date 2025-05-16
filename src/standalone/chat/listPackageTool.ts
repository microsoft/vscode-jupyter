// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import {
    ensureKernelSelectedAndStarted,
    getPackagesFromEnvsExtension,
    packageDefinition,
    sendPipListRequest
} from './helper';
import { IControllerRegistration } from '../../notebooks/controllers/types';

export class ListPackageTool implements vscode.LanguageModelTool<IListPackagesParams> {
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

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IListPackagesParams>,
        token: vscode.CancellationToken
    ) {
        const { filePath } = options.input;

        if (!filePath) {
            throw new Error('notebookUri is a required parameter.');
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

        let packages: packageDefinition[] | undefined = undefined;

        const kernelUri = kernel.kernelConnectionMetadata.interpreter?.uri;
        if (
            kernelUri &&
            (kernel.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                kernel.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter')
        ) {
            packages = await getPackagesFromEnvsExtension(kernelUri);
        }

        if (!packages) {
            // TODO: There is an IInstaller service available, but currently only lists info for a single package.
            // It may also depend on the environment extension?
            packages = await sendPipListRequest(kernel, token);
        }

        if (!packages) {
            throw new Error(`Unable to list packages for notebook ${filePath}.`);
        }

        const contentString = packages.map((pkg) => `${pkg.name}==${pkg.version}`).join(', ');
        const finalMessageString = `Packages installed in notebook: ${contentString}`;
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(finalMessageString)]);
    }

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IListPackagesParams>,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        const filePath = options.input.filePath;
        const uri = vscode.Uri.file(filePath);
        const notebook = vscode.workspace.notebookDocuments.find((n) => n.uri.toString() === uri.toString());

        if (!notebook) {
            return undefined;
        }

        const controller = this.controllerRegistration.getSelected(notebook);
        const kernel = this.kernelProvider.get(notebook);
        if (!controller || !kernel || !kernel.startedAtLeastOnce) {
            return {
                confirmationMessages: {
                    title: vscode.l10n.t(`Start Kernel and List Packages?`),
                    message: vscode.l10n.t('The notebook kernel needs to be started before listing packages')
                },
                invocationMessage: vscode.l10n.t('Starting kernel and listing packages')
            };
        }

        return { invocationMessage: vscode.l10n.t('Listing packages') };
    }
}

export interface IListPackagesParams {
    filePath: string;
}
