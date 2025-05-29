// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ensureKernelSelectedAndStarted,
    getToolResponseForConfiguredNotebook,
    IBaseToolParams,
    resolveNotebookFromFilePath,
    selectKernelAndStart
} from './helper';
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
import { getRecommendedPythonEnvironment } from '../../notebooks/controllers/preferredKernelConnectionService.node';
import { getPythonEnvDisplayName } from '../../platform/interpreter/helpers';
import { logger } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { raceCancellationError } from '../../platform/common/cancellation';

export class SelectRecommendedPythonEnv implements LanguageModelTool<IBaseToolParams> {
    public static toolName = 'select_recommended_python_environment';
    constructor(private readonly controllerRegistration: IControllerRegistration) {}

    async invoke(options: LanguageModelToolInvocationOptions<IBaseToolParams>, token: CancellationToken) {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);

        if (!this.controllerRegistration.getSelected(notebook)) {
            logger.trace(
                `ConfigurePythonNotebookTool: No controller selected for notebook ${getDisplayPath(notebook.uri)}`
            );
            const preferredEnv = await raceCancellationError(token, getRecommendedPythonEnvironment(notebook.uri));
            const preferredController =
                preferredEnv &&
                this.controllerRegistration.all.find(
                    (c) => c.kind === 'startUsingPythonInterpreter' && c.interpreter.id === preferredEnv.id
                );

            // Possible python extension was installed and a controller was selected.
            // Can happen if python extension was initially installed and then disabled later
            if (preferredController) {
                logger.trace(
                    `ConfigurePythonNotebookTool: Selecting recommended Python Env for notebook ${getDisplayPath(
                        notebook.uri
                    )}`
                );
                await selectKernelAndStart(notebook, preferredController, this.controllerRegistration, token);
            }
        }

        logger.trace(`ConfigurePythonNotebookTool: Start kernel for notebook ${getDisplayPath(notebook.uri)}`);
        const kernel = await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, token);
        if (kernel) {
            logger.trace(
                `ConfigurePythonNotebookTool: Kernel selected for notebook ${getDisplayPath(notebook.uri)}, status = ${
                    kernel.status
                }`
            );
        } else {
            logger.trace(
                `ConfigurePythonNotebookTool: No kernel selected for notebook ${getDisplayPath(notebook.uri)}`
            );
        }
        const selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController) {
            logger.trace(`ConfigurePythonNotebookTool: kernel started for notebook ${getDisplayPath(notebook.uri)}`);
            return getToolResponseForConfiguredNotebook(selectedController, kernel);
        }

        logger.trace(`ConfigurePythonNotebookTool: No kernel selected for notebook ${getDisplayPath(notebook.uri)}`);
        return new LanguageModelToolResult([
            new LanguageModelTextPart('User did not select a Kernel for the notebook.')
        ]);
    }

    async prepareInvocation(
        options: LanguageModelToolInvocationPrepareOptions<IBaseToolParams>,
        token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);
        const preferredEnv = await raceCancellationError(token, getRecommendedPythonEnvironment(notebook.uri));
        if (preferredEnv) {
            return {
                confirmationMessages: {
                    title: l10n.t(`Select and start a Python Kernel?`),
                    message: l10n.t(
                        `The Python Environment '{0}' will be selected as the Kernel for the notebook.`,
                        getPythonEnvDisplayName(preferredEnv)
                    )
                },
                invocationMessage: l10n.t('Selecting and starting a Python Kernel')
            };
        }

        return {
            confirmationMessages: {
                title: l10n.t(`Select and start a Python Kernel?`),
                message: l10n.t(
                    'The selected Python Kernel will be started and used for execution of code in the notebook.'
                )
            },
            invocationMessage: l10n.t('Selecting and starting a Python Kernel')
        };
    }
}
