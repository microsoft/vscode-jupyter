// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { ensureKernelSelectedAndStarted, resolveNotebookFromFilePath } from './helper';
import { IControllerRegistration } from '../../notebooks/controllers/types';

export interface IConfigureNotebookToolParams {
    filePath: string;
}

export class ConfigureNotebookTool implements vscode.LanguageModelTool<IConfigureNotebookToolParams> {
    public static toolName = 'configure_notebook';

    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration
    ) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IConfigureNotebookToolParams>,
        token: vscode.CancellationToken
    ) {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);
        let controller = this.controllerRegistration.getSelected(notebook);
        if (!controller) {
            await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, this.kernelProvider, token);
        }
        controller = this.controllerRegistration.getSelected(notebook);
        if (!controller) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No kernel selected for the notebook.')
            ]);
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`The notebook has been configured to use a Kernel '${controller.label}'.`)
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IConfigureNotebookToolParams>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);

        if (!notebook) {
            return {};
        }
        const controller = this.controllerRegistration.getSelected(notebook);
        if (!controller) {
            return {
                confirmationMessages: {
                    title: vscode.l10n.t('Select and start a kernel?'),
                    message: vscode.l10n.t('Once a kernel is selected for the notebook, it will be started.')
                }
            };
        }
        return {};
    }
}
