// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import {
    ensureKernelSelectedAndStarted,
    installPackageThroughEnvsExtension,
    resolveNotebookFromFilePath
} from './helper';
import { IControllerRegistration, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { IInstallationChannelManager } from '../../platform/interpreter/installer/types';
import { getNameOfKernelConnection, isPythonKernelConnection, isPythonNotebook } from '../../kernels/helpers';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { getNotebookMetadata } from '../../platform/common/utils';
import { NotebookDocument } from 'vscode-languageclient';

export interface IConfigureNotebookToolParams {
    filePath: string;
}

export class ConfigureNotebookTool implements vscode.LanguageModelTool<IConfigureNotebookToolParams> {
    public static toolName = 'configure_notebook';

    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration,
        private readonly installationManager: IInstallationChannelManager
    ) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<IConfigureNotebookToolParams>,
        token: vscode.CancellationToken
    ) {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Installation finished successfully.')
        ]);
    }

    prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<IConfigureNotebookToolParams>,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        return {};
    }
}
