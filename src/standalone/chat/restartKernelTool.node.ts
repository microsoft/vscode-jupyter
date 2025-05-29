// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { hasKernelStartedOrIsStarting, IBaseToolParams, resolveNotebookFromFilePath } from './helper.node';
import { IControllerRegistration } from '../../notebooks/controllers/types';

export class RestartKernelTool implements vscode.LanguageModelTool<IBaseToolParams> {
    public static toolName = 'restart_notebook_kernel';

    public get name() {
        return RestartKernelTool.toolName;
    }
    public get description() {
        return 'Restarts the active kernel of a notebook.';
    }

    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration
    ) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IBaseToolParams>,
        _token: vscode.CancellationToken
    ) {
        await vscode.commands.executeCommand('jupyter.restartkernel', vscode.Uri.file(options.input.filePath));
        const finalMessageString = `The kernel for the notebook at ${options.input.filePath} has been restarted.`;
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(finalMessageString)]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IBaseToolParams>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);

        const controller = this.controllerRegistration.getSelected(notebook);
        const kernel = this.kernelProvider.get(notebook);
        if (!controller || !kernel || !hasKernelStartedOrIsStarting(kernel)) {
            throw new Error(
                `No active kernel for notebook ${options.input.filePath}, the configure_notebook tool can be used to help the user select a kernel.`
            );
        }

        return {
            confirmationMessages: {
                title: vscode.l10n.t(`Restart Kernel`),
                message: vscode.l10n.t('Restart the notebook kernel?')
            },
            invocationMessage: vscode.l10n.t('Restarting kernel')
        };
    }
}
