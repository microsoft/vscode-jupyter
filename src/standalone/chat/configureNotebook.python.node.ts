// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IKernelProvider } from '../../kernels/types';
import { ensureKernelSelectedAndStarted, getToolResponseForConfiguredNotebook, selectKernelAndStart } from './helper';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { Commands, PythonExtension as PythonExtensionId } from '../../platform/common/constants';
import {
    CancellationToken,
    commands,
    extensions,
    l10n,
    LanguageModelTextPart,
    LanguageModelToolResult,
    NotebookDocument,
    PreparedToolInvocation
} from 'vscode';
import { getRecommendedPythonEnvironment } from '../../notebooks/controllers/preferredKernelConnectionService.node';
import { getPythonEnvDisplayName } from '../../platform/interpreter/helpers';
import { raceCancellationError } from '../../platform/common/cancellation';

export class ConfigurePythonNotebookTool {
    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration
    ) {}

    async invoke(notebook: NotebookDocument, token: CancellationToken) {
        if (!this.controllerRegistration.getSelected(notebook)) {
            if (!extensions.getExtension(PythonExtensionId)) {
                await raceCancellationError(
                    token,
                    Promise.resolve(commands.executeCommand(Commands.InstallPythonViaKernelPicker))
                );
                const pythonExt = extensions.getExtension(PythonExtensionId);
                if (!pythonExt) {
                    return new LanguageModelToolResult([
                        new LanguageModelTextPart('Python extension is not installed. Please install it to proceed.')
                    ]);
                }
                await pythonExt.activate();
            }

            const preferredEnv = await raceCancellationError(token, getRecommendedPythonEnvironment(notebook.uri));
            const preferredController =
                preferredEnv &&
                this.controllerRegistration.all.find(
                    (c) => c.kind === 'startUsingPythonInterpreter' && c.interpreter.id === preferredEnv.id
                );

            // Possible python extension was installed and a controller was selected.
            // Can happen if python extension was initially installed and then disabled later
            if (preferredController) {
                await selectKernelAndStart(
                    notebook,
                    preferredController,
                    this.controllerRegistration,
                    this.kernelProvider,
                    token
                );
            }
        }

        await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, this.kernelProvider, token);
        const selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController) {
            return getToolResponseForConfiguredNotebook(selectedController);
        }

        return new LanguageModelToolResult([
            new LanguageModelTextPart('User did not select a Kernel for the notebook.')
        ]);
    }

    async prepareInvocation(notebook: NotebookDocument, _token: CancellationToken): Promise<PreparedToolInvocation> {
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
        if (!extensions.getExtension(PythonExtensionId)) {
            return {
                confirmationMessages: {
                    title: l10n.t(`Install Python Extension?`),
                    message: l10n.t(
                        [
                            'The Python extension is required to work on Jupyter Notebooks with Python code.  ',
                            'Once installed a Python Kernel will be selected and started for the notebook. '
                        ].join('  \n')
                    )
                },
                invocationMessage: l10n.t('Selecting and starting a Python Kernel')
            };
        }
        const preferredEnv = await getRecommendedPythonEnvironment(notebook.uri);
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
