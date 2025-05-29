// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelDependencyService, IKernelProvider } from '../../kernels/types';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { JupyterVariablesProvider } from '../variables/JupyterVariablesProvider';
import { logger } from '../../platform/logging';
import { sendPipListRequest } from './helper.node';
import { ListPackageTool } from './listPackageTool.node';
import { InstallPackagesTool } from './installPackageTool.node';
import { IServiceContainer } from '../../platform/ioc/types';
import { IInstallationChannelManager } from '../../platform/interpreter/installer/types';
import { ConfigureNotebookTool } from './configureNotebook.node';
import { ConfigurePythonNotebookTool } from './configureNotebook.python.node';
import { ConfigureNonPythonNotebookTool } from './configureNotebook.other.node';
import { RestartKernelTool } from './restartKernelTool.node';

export async function activate(context: vscode.ExtensionContext, serviceContainer: IServiceContainer): Promise<void> {
    context.subscriptions.push(
        vscode.lm.registerTool(
            InstallPackagesTool.toolName,
            new InstallPackagesTool(
                serviceContainer.get<IKernelProvider>(IKernelProvider),
                serviceContainer.get<IControllerRegistration>(IControllerRegistration),
                serviceContainer.get<IInstallationChannelManager>(IInstallationChannelManager)
            )
        )
    );
    context.subscriptions.push(
        vscode.lm.registerTool(
            ListPackageTool.toolName,
            new ListPackageTool(
                serviceContainer.get<IKernelProvider>(IKernelProvider),
                serviceContainer.get<IControllerRegistration>(IControllerRegistration)
            )
        )
    );

    context.subscriptions.push(
        vscode.lm.registerTool(
            ConfigureNotebookTool.toolName,
            new ConfigureNotebookTool(
                serviceContainer.get<IKernelProvider>(IKernelProvider),
                serviceContainer.get<IControllerRegistration>(IControllerRegistration),
                serviceContainer.get<IKernelDependencyService>(IKernelDependencyService)
            )
        )
    );

    context.subscriptions.push(
        vscode.lm.registerTool(
            ConfigureNonPythonNotebookTool.toolName,
            new ConfigureNonPythonNotebookTool(
                serviceContainer.get<IControllerRegistration>(IControllerRegistration),
                serviceContainer.get<IKernelProvider>(IKernelProvider)
            )
        )
    );

    context.subscriptions.push(
        vscode.lm.registerTool(
            ConfigurePythonNotebookTool.toolName,
            new ConfigurePythonNotebookTool(serviceContainer.get<IControllerRegistration>(IControllerRegistration))
        )
    );

    context.subscriptions.push(
        vscode.lm.registerTool(
            RestartKernelTool.toolName,
            new RestartKernelTool(
                serviceContainer.get<IKernelProvider>(IKernelProvider),
                serviceContainer.get<IControllerRegistration>(IControllerRegistration)
            )
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter.listPipPackages', async (uri) => {
            const documentUri = uri ?? vscode.window.activeNotebookEditor?.notebook.uri;
            if (documentUri) {
                const kernelProvider = serviceContainer.get<IKernelProvider>(IKernelProvider);
                const kernel = await kernelProvider.get(documentUri);
                if (kernel) {
                    const token = new vscode.CancellationTokenSource().token;
                    try {
                        const result = await sendPipListRequest(kernel, token);
                        if (result && Array.isArray(result)) {
                            return result;
                        }
                    } catch (ex) {
                        // ignore
                        logger.warn('Failed to get pip packages', ex);
                    }
                }
            }

            return [];
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter.listVariables', async (uri) => {
            const documentUri = uri ?? vscode.window.activeNotebookEditor?.notebook.uri;

            if (!documentUri) {
                return [];
            }

            const document = vscode.workspace.notebookDocuments.find(
                (item) => item.uri.toString() === documentUri.toString()
            );

            if (!document) {
                return [];
            }

            const controllerRegistry = serviceContainer.get<IControllerRegistration>(IControllerRegistration);
            const controller = controllerRegistry.getSelected(document);
            if (!controller) {
                return [];
            }

            const variablesProvider = controller.controller.variableProvider as JupyterVariablesProvider;
            if (!variablesProvider) {
                return [];
            }

            const token = new vscode.CancellationTokenSource().token;
            const variables = variablesProvider.provideVariablesWithSummarization(
                document,
                undefined,
                vscode.NotebookVariablesRequestKind.Named,
                0,
                token
            );

            const resolvedVariables = [];
            for await (const variable of variables) {
                resolvedVariables.push(variable);
            }
            return resolvedVariables;
        })
    );
}
