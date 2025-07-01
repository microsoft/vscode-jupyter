// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import {
    ensureKernelSelectedAndStarted,
    hasKernelStartedOrIsStarting,
    installPackageThroughEnvsExtension
} from './helper.node';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { IInstallationChannelManager } from '../../platform/interpreter/installer/types';
import { isPythonKernelConnection } from '../../kernels/helpers';
import { RestartKernelTool } from './restartKernelTool.node';
import { BaseTool, IBaseToolParams } from './helper';
import { WrappedError } from '../../platform/errors/types';
import { IDisposable } from '../../platform/common/types';


export class InstallPackagesTool extends BaseTool<IInstallPackageParams> implements IDisposable {
    public static toolName = 'notebook_install_packages';
    private readonly executedNotebooks = new WeakSet<vscode.NotebookDocument>();
    private readonly disposables: vscode.Disposable[] = [];
    constructor(
        private readonly kernelProvider: IKernelProvider,
        private readonly controllerRegistration: IControllerRegistration,
        private readonly installationManager: IInstallationChannelManager
    ) {
        super(InstallPackagesTool.toolName);
        
        // Check existing notebooks for already-executed cells
        this.initializeExecutedNotebooks();
        
        // Track cell execution for all notebooks
        this.disposables.push(
            vscode.workspace.onDidChangeNotebookDocument((e) => {
                for (const change of e.cellChanges) {
                    const cell = change.cell;
                    if (
                        cell.kind === vscode.NotebookCellKind.Code &&
                        typeof cell.executionSummary?.executionOrder === 'number'
                    ) {
                        this.executedNotebooks.add(e.notebook);
                    }
                }
            })
        );
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }

    private initializeExecutedNotebooks(): void {
        // Check all currently open notebooks for executed cells
        for (const notebook of vscode.workspace.notebookDocuments) {
            if (this.hasAnyExecutedCells(notebook)) {
                this.executedNotebooks.add(notebook);
            }
        }
    }

    private hasAnyExecutedCells(notebook: vscode.NotebookDocument): boolean {
        return notebook.getCells().some(cell => 
            cell.kind === vscode.NotebookCellKind.Code &&
            typeof cell.executionSummary?.executionOrder === 'number'
        );
    }

    private hasExecutedCells(notebook: vscode.NotebookDocument): boolean {
        return this.executedNotebooks.has(notebook) || this.hasAnyExecutedCells(notebook);
    }

    async invokeImpl(
        options: vscode.LanguageModelToolInvocationOptions<IInstallPackageParams>,
        notebook: vscode.NotebookDocument,
        token: vscode.CancellationToken
    ) {
        const { packageList } = options.input;

        if (!packageList || packageList.length === 0) {
            throw new WrappedError('filePath and package list are required parameters.', undefined, 'emptyPackageList');
        }

        const kernel = await ensureKernelSelectedAndStarted(notebook, this.controllerRegistration, token);
        if (!kernel) {
            throw new WrappedError(
                `No active kernel for notebook ${notebook.uri}, A kernel needs to be selected.`,
                undefined,
                'noActiveKernel'
            );
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
            const cancellationTokenSource = new vscode.CancellationTokenSource();
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
                        cancellationTokenSource,
                        undefined,
                        true
                    );
                }
                success = true;
            }
        }

        if (!success) {
            const message = `Failed to install one or more packages: ${packageList.join(', ')}.`;
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)]);
        }

        // Only restart the kernel if any cells have been executed in this notebook
        if (this.hasExecutedCells(notebook)) {
            const restartOptionsInput = { ...options.input, reason: 'Packages installed' };
            const restartOptions = { ...options, input: restartOptionsInput };
            try {
                await vscode.lm.invokeTool(RestartKernelTool.toolName, restartOptions);
            } catch (ex) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `Installation finished, but the kernel was not restarted because ${
                            ex.name === 'Canceled' ? 'the user chose not to' : `an error occurred: ${ex.message}`
                        }.`
                    )
                ]);
            }
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    'Installation finished successfully. The kernel has been restarted, so any previously executed cells will need to be re-run.'
                )
            ]);
        } else {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    'Installation finished successfully. No cells have been executed, so the kernel was not restarted.'
                )
            ]);
        }
    }

    async prepareInvocationImpl(
        options: vscode.LanguageModelToolInvocationPrepareOptions<IInstallPackageParams>,
        notebook: vscode.NotebookDocument,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const controller = this.controllerRegistration.getSelected(notebook);
        const kernel = this.kernelProvider.get(notebook);
        if (controller && kernel && hasKernelStartedOrIsStarting(kernel)) {
            return {
                confirmationMessages: {
                    title: vscode.l10n.t(`Install packages?`),
                    message: vscode.l10n.t('Installing packages: {0}', options.input.packageList.join(', '))
                },
                invocationMessage: vscode.l10n.t('Installing packages: {0}', options.input.packageList.join(', '))
            };
        } else {
            return {
                confirmationMessages: {
                    title: vscode.l10n.t(`Start Kernel and Install packages?`),
                    message: vscode.l10n.t(
                        'The notebook kernel needs to be started before installing packages: {0}',
                        options.input.packageList.join(', ')
                    )
                },
                invocationMessage: vscode.l10n.t(
                    'Starting kernel and installing packages: {0}',
                    options.input.packageList.join(', ')
                )
            };
        }
    }
}

export interface IInstallPackageParams extends IBaseToolParams {
    packageList: string[];
}
