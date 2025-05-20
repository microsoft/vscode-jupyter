// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IKernelProvider } from '../../kernels/types';
import {
    getPrimaryLanguageOfNotebook,
    getToolResponseForConfiguredNotebook,
    resolveNotebookFromFilePath
} from './helper';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import {
    CancellationToken,
    LanguageModelTool,
    LanguageModelToolInvocationOptions,
    LanguageModelToolInvocationPrepareOptions,
    PreparedToolInvocation
} from 'vscode';
import { ConfigurePythonNotebookTool } from './configureNotebook.python.node';
import { ConfigureNonPythonNotebookTool } from './configureNotebook.other.node';

export interface IConfigureNotebookToolParams {
    filePath: string;
}

export class ConfigureNotebookTool implements LanguageModelTool<IConfigureNotebookToolParams> {
    public static toolName = 'configure_notebook';
    private readonly configurePythonNotebook: ConfigurePythonNotebookTool;
    private readonly configureNonPythonNotebook: ConfigureNonPythonNotebookTool;
    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration
    ) {
        this.configurePythonNotebook = new ConfigurePythonNotebookTool(kernelProvider, controllerRegistration);
        this.configureNonPythonNotebook = new ConfigureNonPythonNotebookTool(kernelProvider, controllerRegistration);
    }

    async invoke(options: LanguageModelToolInvocationOptions<IConfigureNotebookToolParams>, token: CancellationToken) {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);
        let selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController) {
            return getToolResponseForConfiguredNotebook(selectedController);
        }
        if (getPrimaryLanguageOfNotebook(notebook) == PYTHON_LANGUAGE) {
            return this.configurePythonNotebook.invoke(notebook, token);
        } else {
            return this.configureNonPythonNotebook.invoke(notebook, token);
        }
    }

    async prepareInvocation(
        options: LanguageModelToolInvocationPrepareOptions<IConfigureNotebookToolParams>,
        _token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);
        if (
            this.controllerRegistration.getSelected(notebook) &&
            this.kernelProvider.get(notebook)?.startedAtLeastOnce
        ) {
            return {};
        }

        const language = getPrimaryLanguageOfNotebook(notebook);
        if (language === PYTHON_LANGUAGE) {
            return this.configurePythonNotebook.prepareInvocation(notebook, _token);
        } else {
            return this.configureNonPythonNotebook.prepareInvocation(notebook, _token);
        }
    }
}
