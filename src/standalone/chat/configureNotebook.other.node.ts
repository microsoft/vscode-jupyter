// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ensureKernelSelectedAndStarted,
    getPrimaryLanguageOfNotebook,
    getToolResponseForConfiguredNotebook
} from './helper';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import {
    CancellationToken,
    l10n,
    LanguageModelTextPart,
    LanguageModelToolResult,
    NotebookDocument,
    PreparedToolInvocation
} from 'vscode';

export class ConfigureNonPythonNotebookTool {
    constructor(private readonly controllerRegistration: IControllerRegistration) {}

    async invoke(notebook: NotebookDocument, token: CancellationToken) {
        await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, token);

        const selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController) {
            return getToolResponseForConfiguredNotebook(selectedController);
        }
        return new LanguageModelToolResult([
            new LanguageModelTextPart('User did not select a Kernel for the notebook.')
        ]);
    }

    async prepareInvocation(notebook: NotebookDocument, _token: CancellationToken): Promise<PreparedToolInvocation> {
        const language = getPrimaryLanguageOfNotebook(notebook);
        const controller = this.controllerRegistration.getSelected(notebook);
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
