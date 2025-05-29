// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IKernelDependencyService, IKernelProvider } from '../../kernels/types';
import {
    getPrimaryLanguageOfNotebook,
    getToolResponseForConfiguredNotebook,
    IBaseToolParams,
    resolveNotebookFromFilePath
} from './helper';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { PythonExtension as PythonExtensionId } from '../../platform/common/constants';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import {
    CancellationToken,
    extensions,
    l10n,
    LanguageModelTool,
    LanguageModelToolInvocationOptions,
    LanguageModelToolInvocationPrepareOptions,
    lm,
    NotebookDocument,
    PreparedToolInvocation
} from 'vscode';
import { ConfigurePythonNotebookTool, IConfigurePythonNotebookToolParams } from './configureNotebook.python.node';
import { ConfigureNonPythonNotebookTool } from './configureNotebook.other.node';
import { logger } from '../../platform/logging';
import { getRecommendedPythonEnvironment } from '../../notebooks/controllers/preferredKernelConnectionService.node';
import { createVirtualEnvAndSelectAsKernel, shouldCreateVirtualEnvForNotebook } from './createVirtualEnv.python.node';
import { sleep } from '../../platform/common/utils/async';

export class ConfigureNotebookTool implements LanguageModelTool<IBaseToolParams> {
    public static toolName = 'configure_notebook';
    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration,
        private readonly kernelDependencyService: IKernelDependencyService
    ) {}

    async invoke(options: LanguageModelToolInvocationOptions<IBaseToolParams>, token: CancellationToken) {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        // If user user just reloaded vscode, possible Python/Jupyter ext is a little slow in creating the controller for VSC to pre-select an existing controller
        await sleep(1_000);
        let selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController && this.kernelProvider.get(notebook)?.startedAtLeastOnce) {
            return getToolResponseForConfiguredNotebook(selectedController);
        }
        if (getPrimaryLanguageOfNotebook(notebook) !== PYTHON_LANGUAGE) {
            return lm.invokeTool(ConfigureNonPythonNotebookTool.name, options, token);
        } else {
            return this.invokeToolForPython(options, notebook, token);
        }
    }
    private async invokeToolForPython(
        options: LanguageModelToolInvocationOptions<IBaseToolParams>,
        notebook: NotebookDocument,
        token: CancellationToken
    ) {
        // If we do not have Python extension installed, then install that.
        if (!extensions.getExtension(PythonExtensionId)) {
            try {
                const input = { id: PythonExtensionId, name: 'Python' };
                await lm.invokeTool('copilot_installExtension', { ...options, input }, token);
            } catch (ex) {
                // Any error can be ignored, e.g. user cancelling the install of the extension or failure to install the extension.
                logger.error(`Error while installing Python extension`, ex);
            }
        }

        // If we have already selected a controller then start that.
        // If we have a preferred Python Env, then recommend that.
        if (
            this.controllerRegistration.getSelected(notebook) ||
            (await getRecommendedPythonEnvironment(notebook.uri))
        ) {
            try {
                return await lm.invokeTool(ConfigurePythonNotebookTool.toolName, options, token);
            } catch (ex) {
                // What ever the error, fallback to the user selecting a kernel via quick pick.
                logger.error(`Error while selecting the recommended Python env`, ex);
            }
        } else if (await shouldCreateVirtualEnvForNotebook(notebook, token)) {
            try {
                if (
                    await createVirtualEnvAndSelectAsKernel(
                        options,
                        notebook,
                        this.controllerRegistration,
                        this.kernelDependencyService,
                        token
                    )
                ) {
                    // If it was successful, now start the kernel.
                    return await lm.invokeTool(ConfigurePythonNotebookTool.toolName, options, token);
                }
                // Not created for whatever reason, fall back to kernel selection.
            } catch (ex) {
                // What ever the error, fallback to the user selecting a kernel via quick pick.
                logger.error(`Error while creating a venv and selecting that`, ex);
            }
        }

        // If we're here, then there was no preferred environment or the user cancelled the selection.
        // Or user didn't create a virtual environment.
        // Fall back to the tool that allows the user to select a kernel.
        const input: IConfigurePythonNotebookToolParams = {
            ...options.input,
            action: 'select' // select a kernel, as opposed to recommending one (as we've already tried that approach a few lines earlier)
        };
        return lm.invokeTool(ConfigurePythonNotebookTool.toolName, { ...options, input }, token);
    }

    async prepareInvocation(
        _options: LanguageModelToolInvocationPrepareOptions<IBaseToolParams>,
        _token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        return {
            invocationMessage: l10n.t('Configuring notebook')
        };
    }
}
