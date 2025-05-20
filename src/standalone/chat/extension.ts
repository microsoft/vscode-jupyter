// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { JupyterVariablesProvider } from '../variables/JupyterVariablesProvider';
import { logger } from '../../platform/logging';
import { sendPipListRequest } from './helper';
import { ListPackageTool } from './listPackageTool';
import { InstallPackagesTool } from './installPackageTool';
import { IServiceContainer } from '../../platform/ioc/types';
import { IInstallationChannelManager } from '../../platform/interpreter/installer/types';

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
            'configure_notebooks_before_execution',
            new (class implements vscode.LanguageModelTool<unknown> {
                async invoke(
                    _options: vscode.LanguageModelToolInvocationOptions<unknown>,
                    _token: vscode.CancellationToken
                ): Promise<vscode.LanguageModelToolResult> {
                    // This tool is a no-op, it just exists to ensure that the chat model can be used in notebooks.
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('')]);
                }

                prepareInvocation(
                    _options: vscode.LanguageModelToolInvocationPrepareOptions<unknown>,
                    __token: vscode.CancellationToken
                ): vscode.ProviderResult<vscode.PreparedToolInvocation> {
                    return {
                        confirmationMessages: {
                            title: 'Configure Jupyter Notebook for Execution?',
                            message: ''
                        },
                        invocationMessage: 'Configuring Jupyter Notebook for execution'
                    };
                }
            })()
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

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() {}
