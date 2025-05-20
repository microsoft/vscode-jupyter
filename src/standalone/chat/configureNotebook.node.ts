// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IKernelProvider } from '../../kernels/types';
import { ensureKernelSelectedAndStarted, resolveNotebookFromFilePath, selectKernelAndStart } from './helper';
import { IControllerRegistration, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { getNameOfKernelConnection, isPythonNotebook } from '../../kernels/helpers';
import { Commands, PYTHON_LANGUAGE, PythonExtension as PythonExtensionId } from '../../platform/common/constants';
import { getNotebookMetadata } from '../../platform/common/utils';
import {
    CancellationToken,
    commands,
    extensions,
    l10n,
    LanguageModelTextPart,
    LanguageModelTool,
    LanguageModelToolInvocationOptions,
    LanguageModelToolInvocationPrepareOptions,
    LanguageModelToolResult,
    NotebookCellKind,
    NotebookDocument,
    PreparedToolInvocation
} from 'vscode';
import { getRecommendedPythonEnvironment } from '../../notebooks/controllers/preferredKernelConnectionService.node';
import { inject } from 'inversify';
import { getPythonEnvDisplayName } from '../../platform/interpreter/helpers';

export interface IConfigureNotebookToolParams {
    filePath: string;
}

export class ConfigureNotebookTool implements LanguageModelTool<IConfigureNotebookToolParams> {
    public static toolName = 'configure_notebook';

    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration
    ) {}

    async invoke(options: LanguageModelToolInvocationOptions<IConfigureNotebookToolParams>, token: CancellationToken) {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);
        let selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController) {
            return getToolResponseForSelection(selectedController);
        }
        const language = getPrimaryLanguageOfNotebook(notebook);
        if (language !== PYTHON_LANGUAGE) {
            await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, this.kernelProvider, token);
            const selectedController = this.controllerRegistration.getSelected(notebook);
            if (selectedController) {
                return getToolResponseForSelection(selectedController);
            }
            return new LanguageModelToolResult([
                new LanguageModelTextPart('User did not select a Kernel for the notebook.')
            ]);
        }

        if (!extensions.getExtension(PythonExtensionId)) {
            await commands.executeCommand(Commands.InstallPythonViaKernelPicker);
            const pythonExt = extensions.getExtension(PythonExtensionId);
            if (!pythonExt) {
                return new LanguageModelToolResult([
                    new LanguageModelTextPart('Python extension is not installed. Please install it to proceed.')
                ]);
            }
            await pythonExt.activate();
        }

        const preferredEnv = await getRecommendedPythonEnvironment(notebook.uri);

        // Possible python extension was installed and a controller was selected.
        // Can happen if python extension was initially installed and then disabled later
        selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController) {
            return getToolResponseForSelection(selectedController);
        }

        if (preferredEnv) {
            const preferredController = this.controllerRegistration.all.find(
                (c) => c.kind === 'startUsingPythonInterpreter' && c.interpreter.id === preferredEnv.id
            );
            if (preferredController) {
                await selectKernelAndStart(
                    notebook,
                    preferredController,
                    this.controllerRegistration,
                    this.kernelProvider,
                    token
                );
            }
        } else {
            await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, this.kernelProvider, token);
        }

        selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController) {
            return getToolResponseForSelection(selectedController);
        }

        return new LanguageModelToolResult([
            new LanguageModelTextPart('User did not select a Kernel for the notebook.')
        ]);
    }

    async prepareInvocation(
        options: LanguageModelToolInvocationPrepareOptions<IConfigureNotebookToolParams>,
        _token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);
        const language = getPrimaryLanguageOfNotebook(notebook);
        if (language === PYTHON_LANGUAGE) {
            return this.getInvocationInfoForLocalPythonKernel(notebook);
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
    private async getInvocationInfoForLocalPythonKernel(notebook: NotebookDocument): Promise<PreparedToolInvocation> {
        const controller = this.controllerRegistration.getSelected(notebook);
        if (controller) {
            return {};
        }
        if (!extensions.getExtension(PythonExtensionId)) {
            return {
                confirmationMessages: {
                    title: l10n.t(`Install Python Extension?`),
                    message: l10n.t('The Python extension is required to work on Jupyter Notebooks with Python code.')
                },
                invocationMessage: l10n.t('Installing the Python Extension')
            };
        }
        const preferredEnv = await getRecommendedPythonEnvironment(notebook.uri);
        if (preferredEnv) {
            const displayName = getPythonEnvDisplayName(preferredEnv);
            return {
                confirmationMessages: {
                    title: l10n.t(`Select and start a Python Kernel?`),
                    message: l10n.t(
                        `The Python Environment '{0}' will be selected as the Kernel for the notebook.`,
                        displayName
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

function getToolResponseForSelection(selectedController: IVSCodeNotebookController): LanguageModelToolResult {
    const messages = [
        `Notebook has been configured to use the kernel ${
            selectedController.label || getNameOfKernelConnection(selectedController.connection)
        }`
    ];
    return new LanguageModelToolResult([new LanguageModelTextPart(messages.join(' '))]);
}

function getPrimaryLanguageOfNotebook(notebook: NotebookDocument) {
    if (notebook.getCells().some((c) => c.document.languageId === PYTHON_LANGUAGE)) {
        return PYTHON_LANGUAGE;
    }
    if (isPythonNotebook(getNotebookMetadata(notebook))) {
        return PYTHON_LANGUAGE;
    }
    return notebook.getCells().find((c) => c.kind === NotebookCellKind.Code)?.document.languageId || PYTHON_LANGUAGE;
}
