// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ensureKernelSelectedAndStarted,
    getPrimaryLanguageOfNotebook,
    getToolResponseForConfiguredNotebook,
    hasKernelStartedOrIsStarting,
    IBaseToolParams,
    resolveNotebookFromFilePath
} from './helper.node';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import {
    CancellationToken,
    l10n,
    LanguageModelTextPart,
    LanguageModelTool,
    LanguageModelToolInvocationOptions,
    LanguageModelToolInvocationPrepareOptions,
    LanguageModelToolResult,
    PreparedToolInvocation
} from 'vscode';
import { IKernelProvider } from '../../kernels/types';

export class ConfigureNonPythonNotebookTool implements LanguageModelTool<IBaseToolParams> {
    public static toolName = 'configure_non_python_notebook';
    constructor(
        private readonly controllerRegistration: IControllerRegistration,
        private readonly kernelProvider: IKernelProvider
    ) {}

    async invoke(options: LanguageModelToolInvocationOptions<IBaseToolParams>, token: CancellationToken) {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, token);

        const selectedController = this.controllerRegistration.getSelected(notebook);
        const kernel = this.kernelProvider.get(notebook);
        if (selectedController) {
            return getToolResponseForConfiguredNotebook(selectedController, kernel);
        }
        return new LanguageModelToolResult([
            new LanguageModelTextPart('User did not select a Kernel for the notebook.')
        ]);
    }

    async prepareInvocation(
        options: LanguageModelToolInvocationPrepareOptions<IBaseToolParams>,
        _token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        const language = getPrimaryLanguageOfNotebook(notebook);
        const controller = this.controllerRegistration.getSelected(notebook);
        const kernel = this.kernelProvider.get(notebook.uri);
        if (controller && kernel && hasKernelStartedOrIsStarting(kernel)) {
            return {
                invocationMessage: l10n.t('Using {0} Kernel', language)
            };
        }

        if (controller) {
            return {
                confirmationMessages: {
                    title: l10n.t(`Start Kernel?`),
                    message: l10n.t('The {0} kernel {1} will be started', language, controller.label)
                },
                invocationMessage: l10n.t('Starting {0} Kernel', language)
            };
        }

        return {
            confirmationMessages: {
                title: l10n.t(`Select and start a {0} Kernel?`, language),
                message: l10n.t(
                    'The selected {0} Kernel will be started and used for execution of code in the notebook.',
                    language
                )
            },
            invocationMessage: l10n.t('Selecting and starting a {0} Kernel', language)
        };
    }
}
