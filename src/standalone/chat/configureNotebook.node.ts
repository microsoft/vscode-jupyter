// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IKernelProvider } from '../../kernels/types';
import {
    ensureKernelSelectedAndStarted,
    installPackageThroughEnvsExtension,
    resolveNotebookFromFilePath
} from './helper';
import { IControllerRegistration, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { IInstallationChannelManager } from '../../platform/interpreter/installer/types';
import {
    getDisplayNameOrNameOfKernelConnection,
    getDisplayNameOrNameOfPythonKernelConnection,
    getNameOfKernelConnection,
    isPythonKernelConnection,
    isPythonNotebook
} from '../../kernels/helpers';
import { PYTHON_LANGUAGE, PythonExtension as PythonExtensionId } from '../../platform/common/constants';
import { getNotebookMetadata } from '../../platform/common/utils';
import { IPythonApiProvider } from '../../platform/api/types';
import {
    CancellationToken,
    extensions,
    l10n,
    LanguageModelTextPart,
    LanguageModelTool,
    LanguageModelToolInvocationOptions,
    LanguageModelToolInvocationPrepareOptions,
    LanguageModelToolResult,
    NotebookCellKind,
    NotebookDocument,
    PreparedToolInvocation,
    Uri,
    workspace
} from 'vscode';
import { PythonExtension } from '@vscode/python-extension';
import { findPreferredPythonEnvironment } from '../../notebooks/controllers/preferredKernelConnectionService.node';
import { PythonEnvironmentFilter } from '../../platform/interpreter/filter/filterService';
import { inject } from 'inversify';
import { INotebookPythonEnvironmentService } from '../../notebooks/types';
import { IPythonChatTools } from '../../platform/api/pythonApi';

export interface IConfigureNotebookToolParams {
    filePath: string;
}

export class ConfigureNotebookTool implements LanguageModelTool<IConfigureNotebookToolParams> {
    public static toolName = 'configure_notebook';

    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IInstallationChannelManager) private readonly installationManager: IInstallationChannelManager,
        @inject(IPythonApiProvider) private readonly pythonApi: IPythonApiProvider,
        @inject(PythonEnvironmentFilter) private readonly filter: PythonEnvironmentFilter,
        @inject(INotebookPythonEnvironmentService)
        private readonly notebookEnvironment: INotebookPythonEnvironmentService,
        @inject(IPythonChatTools) private readonly pythonChatTools: IPythonChatTools
    ) {}

    async invoke(options: LanguageModelToolInvocationOptions<IConfigureNotebookToolParams>, token: CancellationToken) {
        const { filePath } = options.input;
        const notebook = await resolveNotebookFromFilePath(filePath);

        const selectedController = this.controllerRegistration.getSelected(notebook);
        if (selectedController) {
            return getToolResponseForSelection(filePath, selectedController);
        }
        const kernel = await ensureKernelSelectedAndStarted(
            notebook,
            this.controllerRegistration,
            this.kernelProvider,
            token
        );

        if (!kernel) {
            throw new Error(`No active kernel for notebook ${filePath}, A kernel needs to be selected.`);
        }

        let success: boolean = false;
        const kernelUri = kernel.kernelConnectionMetadata.interpreter?.uri;
        if (
            kernelUri &&
            isPythonKernelConnection(kernel.kernelConnectionMetadata) &&
            (kernel.kernelConnectionMetadata.kind === 'startUsingLocalKernelSpec' ||
                kernel.kernelConnectionMetadata.kind === 'startUsingPythonInterpreter')
        ) {
            success = await installPackageThroughEnvsExtension(kernelUri, packageList);
        }

        if (!success && kernel.kernelConnectionMetadata.interpreter) {
            const cancellationTokenSource = new CancellationTokenSource();
            token.onCancellationRequested(() => cancellationTokenSource.cancel());
            const installers = await this.installationManager.getInstallationChannels(
                kernel.kernelConnectionMetadata.interpreter
            );
            if (installers.length > 0) {
                const installer = installers[0];
                for (const packageName of packageList) {
                    await installer.installModule(
                        packageName,
                        kernel.kernelConnectionMetadata.interpreter,
                        cancellationTokenSource
                    );
                }
                success = true;
            }
        }

        if (!success) {
            const message = `Failed to install one or more packages: ${packageList.join(', ')}.`;
            return new LanguageModelToolResult([new LanguageModelTextPart(message)]);
        }

        return new LanguageModelToolResult([new LanguageModelTextPart('Installation finished successfully.')]);
    }

    async prepareInvocation(
        options: LanguageModelToolInvocationPrepareOptions<IConfigureNotebookToolParams>,
        _token: CancellationToken
    ): Promise<PreparedToolInvocation> {
        const filePath = options.input.filePath;
        const uri = Uri.file(filePath);
        const notebook = workspace.notebookDocuments.find((n) => n.uri.toString() === uri.toString());
        const controller = notebook ? this.controllerRegistration.getSelected(notebook) : undefined;
        const kernel = notebook ? this.kernelProvider.get(notebook) : undefined;
        if (!controller || !kernel || !kernel.startedAtLeastOnce) {
            return {
                confirmationMessages: {
                    title: l10n.t(`Configure Jupyter Notebook?`),
                    message: l10n.t(
                        'The notebook kernel needs to be started before installing packages: {0}',
                        options.input.packageList.join(', ')
                    )
                },
                invocationMessage: l10n.t(
                    'Starting kernel and installing packages: {0}',
                    options.input.packageList.join(', ')
                )
            };
        }

        const packageInstallationPrompt = l10n.t(
            'Installing packages into notebook kernel: {0}',
            options.input.packageList.join(', ')
        );
        const confirmationMessages = {
            title: l10n.t(`Install Packages`),
            message: packageInstallationPrompt
        };

        return {
            confirmationMessages,
            invocationMessage: packageInstallationPrompt
        };
    }
    private async getInvocationInfoForLocalPythonKernel(notebook: NotebookDocument): Promise<PreparedToolInvocation> {
        if (!extensions.all.some((ext) => ext.id === PythonExtensionId)) {
            return {
                confirmationMessages: {
                    title: l10n.t(`Install Python Extension?`),
                    message: l10n.t('The Python extension is required to work on Jupyter Notebooks with Python code.')
                },
                invocationMessage: l10n.t('Installing the Python Extension')
            };
        }
        const api = await PythonExtension.api();
        const env = await api.environments.resolveEnvironment(api.environments.getActiveEnvironmentPath(notebook.uri));
        if (env) {
            return {};
        }
        const preferredEnv = await findPreferredPythonEnvironment(
            notebook,
            api,
            this.filter,
            this.notebookEnvironment,
            this.pythonChatTools
        );
        if (!preferredEnv) {
            return {
                confirmationMessages: {
                    title: l10n.t(`Create Virtual Environment?`),
                    message: l10n.t(
                        'Creating a Virtual Environment is recommended. This provides the benefit of preventing conflicts between packages in this environment and others.'
                    )
                },
                invocationMessage: l10n.t('Creating a Virtual Environment.')
            };
        }

        const displayName =
            getDisplayNameOrNameOfPythonKernelConnection(preferredEnv) ||
            preferredEnv.environment?.name ||
            preferredEnv.path;

        return {
            confirmationMessages: {
                title: l10n.t('Select Python Environment?'),
                message: l10n.t(
                    `The Python Environment '{0}' will be selected as the Kernel for the notebook.`,
                    displayName
                )
            },
            invocationMessage: l10n.t('Select Python Environment: {0}', displayName)
        };
    }
}

function getToolResponseForSelection(
    filePath: string,
    selectedController: IVSCodeNotebookController
): LanguageModelToolResult {
    const messages = [
        `Kernel already selected for notebook ${filePath}.`,
        `Name of the kernel is ${getNameOfKernelConnection(selectedController.connection)}`
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
