// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ensureKernelSelectedAndStarted,
    getToolResponseForConfiguredNotebook,
    IBaseToolParams,
    resolveNotebookFromFilePath,
    selectKernelAndStart
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
import { getRecommendedPythonEnvironment } from '../../notebooks/controllers/preferredKernelConnectionService.node';
import { getPythonEnvDisplayName } from '../../platform/interpreter/helpers';
import { raceCancellationError } from '../../platform/common/cancellation';
import { logger } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';

export interface IConfigurePythonNotebookToolParams extends IBaseToolParams {
    action?: 'select';
}

export class ConfigurePythonNotebookTool implements LanguageModelTool<IBaseToolParams> {
    public static toolName = 'configure_python_notebook';
    constructor(private readonly controllerRegistration: IControllerRegistration) {}

    async invoke(
        options: LanguageModelToolInvocationOptions<IConfigurePythonNotebookToolParams>,
        token: CancellationToken
    ) {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        if (!this.controllerRegistration.getSelected(notebook) && options.input.action !== 'select') {
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
        options: LanguageModelToolInvocationPrepareOptions<IConfigurePythonNotebookToolParams>,
        _token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        const controller = this.controllerRegistration.getSelected(notebook);
        if (controller) {
            return {
                confirmationMessages: {
                    title: l10n.t(`Start Kernel?`),
                    message: l10n.t('The Python kernel {0} will be started', controller.label)
                },
                invocationMessage: l10n.t('Starting Python Kernel')
            };
        }
        const preferredEnv = await getRecommendedPythonEnvironment(notebook.uri);
        if (preferredEnv && options.input.action !== 'select') {
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
