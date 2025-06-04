// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { hasKernelStartedOrIsStarting, IBaseToolParams, resolveNotebookFromFilePath } from './helper.node';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { getUntrustedWorkspaceResponse, sendLMToolCallTelemetry } from './helper';
import { INotebookCommandHandler } from '../../notebooks/notebookCommandListener';
import { basename } from '../../platform/vscode-path/resources';

interface RestartKernelToolParams extends IBaseToolParams {
    reason?: string;
}

export class RestartKernelTool implements vscode.LanguageModelTool<RestartKernelToolParams> {
    public static toolName = 'restart_notebook_kernel';

    public get name() {
        return RestartKernelTool.toolName;
    }
    public get description() {
        return 'Restarts the active kernel of a notebook.';
    }

    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration,
        private readonly notebookCommandHandler: INotebookCommandHandler
    ) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RestartKernelToolParams>,
        _token: vscode.CancellationToken
    ) {
        if (!vscode.workspace.isTrusted) {
            return getUntrustedWorkspaceResponse();
        }
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        sendLMToolCallTelemetry(RestartKernelTool.toolName, notebook.uri);
        await this.notebookCommandHandler.restartKernel(notebook.uri, true);
        const finalMessageString = `The kernel for the notebook at ${options.input.filePath} has been restarted and any state from previous cell executions has been cleared.`;
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(finalMessageString)]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RestartKernelToolParams>,
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
        const nbName = basename(notebook.uri);

        return {
            confirmationMessages: {
                title: vscode.l10n.t(`Restart Kernel?`),
                message:
                    options.input.reason ?? vscode.l10n.t('The kernel for the notebook {0} will be restarted.', nbName)
            },
            invocationMessage: vscode.l10n.t('Restarting kernel for {0}', nbName)
        };
    }
}
