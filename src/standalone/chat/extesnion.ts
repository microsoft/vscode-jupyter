// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import * as vscode from 'vscode';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { execCodeInBackgroundThread } from '../api/kernels/backgroundExecution';
import { ServiceContainer } from '../../platform/ioc/container';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { JupyterVariablesProvider } from '../../kernels/variables/JupyterVariablesProvider';
import { traceWarning } from '../../platform/logging';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    context.subscriptions.push(
        vscode.commands.registerCommand('jupyter.listPipPackages', async (uri) => {
            const documentUri = uri ?? vscode.window.activeNotebookEditor?.notebook.uri;
            if (documentUri) {
                const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
                const kernel = await kernelProvider.get(documentUri);
                if (kernel) {
                    const token = new vscode.CancellationTokenSource().token;
                    try {
                        const result = await sendPipListRequest(kernel, token);
                        if (Array.isArray(result.content)) {
                            return result.content;
                        }
                    } catch (ex) {
                        // ignore
                        traceWarning('Failed to get pip packages', ex);
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

            const controllerRegistry = ServiceContainer.instance.get<IControllerRegistration>(IControllerRegistration);
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

async function sendPipListRequest(kernel: IKernel, token: vscode.CancellationToken) {
    const codeToExecute = `import subprocess
proc = subprocess.Popen(["pip", "list", "--format", "json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
stdout, stderr = proc.communicate()
return stdout
`.split('\n');

    try {
        const content = await execCodeInBackgroundThread<KernelMessage.IInspectReplyMsg['content']>(
            kernel,
            codeToExecute,
            token
        );
        return { content } as KernelMessage.IInspectReplyMsg;
    } catch (ex) {
        throw ex;
    }
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() {}
