// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IBaseToolParams, resolveNotebookFromFilePath } from './helper';
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
import { IKernelDependencyService } from '../../kernels/types';
import { isPythonKernelConnection } from '../../kernels/helpers';
import { DisplayOptions } from '../../kernels/displayOptions';

export class InstallPythonNotebookDependenciesTool implements LanguageModelTool<IBaseToolParams> {
    public static toolName = 'install_python_dependencies_notebook';
    constructor(
        private readonly controllerRegistration: IControllerRegistration,
        private readonly kernelDependencyService: IKernelDependencyService
    ) {}

    async invoke(options: LanguageModelToolInvocationOptions<IBaseToolParams>, token: CancellationToken) {
        const notebook = await resolveNotebookFromFilePath(options.input.filePath);
        const kernelConnection = this.controllerRegistration.getSelected(notebook)?.connection;
        if (kernelConnection && isPythonKernelConnection(kernelConnection)) {
            await this.kernelDependencyService.installMissingDependencies({
                resource: notebook.uri,
                kernelConnection,
                ui: new DisplayOptions(true),
                token,
                ignoreCache: false,
                installWithoutPrompting: true
            });
        }
        return new LanguageModelToolResult([
            new LanguageModelTextPart('Python Kernel dependencies installed successfully. ')
        ]);
    }

    async prepareInvocation(
        _options: LanguageModelToolInvocationPrepareOptions<IBaseToolParams>,
        _token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        return {
            invocationMessage: l10n.t('Installing Kernel dependencies')
        };
    }
}
