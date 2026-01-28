// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ensureKernelSelectedAndStarted,
    getPrimaryLanguageOfNotebook,
    getToolResponseForConfiguredNotebook,
    hasKernelStartedOrIsStarting
} from './helper.node';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import {
    CancellationToken,
    l10n,
    LanguageModelTextPart,
    LanguageModelToolInvocationOptions,
    LanguageModelToolInvocationPrepareOptions,
    LanguageModelToolResult,
    NotebookDocument,
    PreparedToolInvocation
} from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { BaseTool, IBaseToolParams } from './helper';

export class ConfigureNonPythonNotebookTool extends BaseTool<IBaseToolParams> {
    public static toolName = 'configure_non_python_notebook';
    constructor(
        private readonly controllerRegistration: IControllerRegistration,
        private readonly kernelProvider: IKernelProvider
    ) {
        super(ConfigureNonPythonNotebookTool.toolName);
    }

    async invokeImpl(
        _options: LanguageModelToolInvocationOptions<IBaseToolParams>,
        notebook: NotebookDocument,
        token: CancellationToken
    ) {
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

    async prepareInvocationImpl(
        _options: LanguageModelToolInvocationPrepareOptions<IBaseToolParams>,
        notebook: NotebookDocument,
        _token: CancellationToken
    ): Promise<PreparedToolInvocation> {
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
