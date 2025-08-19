// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { commands, window, QuickPickItem, NotebookDocument } from 'vscode';
import { Commands } from '../../platform/common/constants';
import type { ICommandNameArgumentTypeMapping } from '../../commands';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { logger } from '../../platform/logging';
import { ExternalJupyterServerLauncher, IExternalServerConfig } from './externalJupyterServerLauncher.node';
import { DisposableBase } from '../../platform/common/utils/lifecycle';
import { IKernelFinder } from '../../kernels/types';
import { ContributedKernelFinderKind } from '../../kernels/internalTypes';
import { InputFlowAction } from '../../platform/common/utils/multiStepInput';

/**
 * Registers VS Code commands for external server management.
 */
@injectable()
export class ExternalServerCommandRegistry
    extends DisposableBase
    implements IExtensionSyncActivationService
{
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(ExternalJupyterServerLauncher) private readonly serverLauncher: ExternalJupyterServerLauncher,
        @inject(IKernelFinder) private readonly kernelFinder: IKernelFinder
    ) {
        super();
        disposables.push(this);
    }

    activate(): void {
        this.registerCommand(Commands.LaunchExternalJupyterServer, () => this.launchExternalServer());
    }

    private registerCommand<T extends keyof ICommandNameArgumentTypeMapping>(
        command: T,
        callback: (...args: ICommandNameArgumentTypeMapping[T]) => any
    ) {
        const disposable = commands.registerCommand(command, callback, this);
        this._register(disposable);
    }

    private async launchExternalServer(_notebook?: NotebookDocument): Promise<void> {
        try {
            // Use the proper multi-step input pattern for back button
            const result = await this.showServerConfigurationWithBackButton();
            if (!result || result === InputFlowAction.back) {
                return; // User cancelled or went back
            }
            
            const config = result;

            await window.withProgress(
                {
                    location: { viewId: 'jupyter-servers' },
                    title: 'Starting External Jupyter Server...',
                    cancellable: true
                },
                async (progress, token) => {
                    progress.report({ message: 'Launching server process...' });
                    
                    const handle = await this.serverLauncher.launchAndConnect(config, token);
                    
                    if (handle) {
                        progress.report({ message: 'Server started and connected successfully' });
                        
                        // Trigger kernel refresh to discover kernels from the new server
                        progress.report({ message: 'Refreshing kernel list...' });
                        
                        // Find and refresh the remote kernel finder specifically
                        const remoteKernelFinder = this.kernelFinder.registered.find(
                            finder => finder.kind === ContributedKernelFinderKind.Remote
                        );
                        if (remoteKernelFinder) {
                            await remoteKernelFinder.refresh();
                        }
                        
                        // Give it a moment for the UI to update
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Re-open the kernel picker if there's an active notebook
                        const activeNotebook = window.activeNotebookEditor?.notebook;
                        if (activeNotebook) {
                            try {
                                await commands.executeCommand('notebook.selectKernel');
                            } catch (error) {
                                // If the command fails, just log it - the server is still connected
                                logger.debug('Could not re-open kernel picker:', error);
                            }
                        }
                    } else {
                        progress.report({ message: 'Server started but auto-connect failed' });
                    }
                }
            );
        } catch (error) {
            logger.error('Failed to launch external Jupyter server', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            await window.showErrorMessage(`Failed to launch Jupyter server: ${errorMessage}`);
        }
    }

    private async showServerConfigurationDialog(): Promise<IExternalServerConfig | undefined> {
        interface ConfigPickItem extends QuickPickItem {
            id: string;
        }

        const options: ConfigPickItem[] = [
            {
                id: 'quick',
                label: '$(rocket) Quick Launch',
                description: 'Launch with default settings',
                detail: 'Auto-assign port, use workspace directory, JupyterLab interface'
            },
            {
                id: 'custom',
                label: '$(settings-gear) Custom Configuration',
                description: 'Configure server settings',
                detail: 'Choose port, directory, and additional options'
            },
            {
                id: 'notebook',
                label: '$(book) Jupyter Notebook',
                description: 'Launch with classic Notebook interface',
                detail: 'Uses Jupyter Notebook instead of JupyterLab'
            }
        ];

        const selectedOption = await window.showQuickPick(options, {
            title: 'Launch Persistent Kernel',
            placeHolder: 'Choose launch configuration',
            ignoreFocusOut: true
        });

        if (!selectedOption) {
            return undefined;
        }

        switch (selectedOption.id) {
            case 'quick':
                return {}; // Use defaults

            case 'custom':
                return await this.showCustomConfiguration();

            case 'notebook':
                return {
                    name: 'External Jupyter Notebook',
                    args: ['-m', 'jupyter', 'notebook'] // Override to use notebook
                };

            default:
                return undefined;
        }
    }

    private async showCustomConfiguration(): Promise<IExternalServerConfig | undefined> {
        const config: IExternalServerConfig = {};

        // Server name
        const name = await window.showInputBox({
            title: 'Server Configuration: Display Name',
            placeHolder: 'Enter a display name for this server (optional)',
            ignoreFocusOut: true
        });
        
        if (name) {
            config.name = name;
        }

        // Port
        const portInput = await window.showInputBox({
            title: 'Server Configuration: Port',
            placeHolder: 'Enter port number (leave empty for auto-assign)',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value) return undefined; // Empty is OK (auto-assign)
                const port = parseInt(value);
                if (isNaN(port) || port < 1024 || port > 65535) {
                    return 'Port must be a number between 1024 and 65535';
                }
                return undefined;
            }
        });
        
        if (portInput) {
            config.port = parseInt(portInput);
        }

        // Working directory
        const dirOptions = [
            'Use workspace directory',
            'Choose custom directory'
        ];

        const dirChoice = await window.showQuickPick(dirOptions, {
            title: 'Server Configuration: Working Directory',
            placeHolder: 'Select working directory for the server',
            ignoreFocusOut: true
        });

        if (dirChoice === 'Choose custom directory') {
            const selectedDir = await window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: 'Select Working Directory'
            });

            if (selectedDir && selectedDir[0]) {
                config.workingDirectory = selectedDir[0].fsPath;
            } else {
                return undefined; // User cancelled
            }
        }

        // Additional options
        const additionalOptions = await window.showQuickPick([
            'No additional options',
            'Add custom arguments'
        ], {
            title: 'Server Configuration: Additional Options',
            placeHolder: 'Choose additional configuration options',
            ignoreFocusOut: true
        });

        if (additionalOptions === 'Add custom arguments') {
            const argsInput = await window.showInputBox({
                title: 'Server Configuration: Custom Arguments',
                placeHolder: 'Enter additional command line arguments (space-separated)',
                ignoreFocusOut: true
            });

            if (argsInput) {
                config.args = argsInput.split(' ').filter(arg => arg.trim());
            }
        }

        return config;
    }

    private async showServerConfigurationWithBackButton(): Promise<IExternalServerConfig | InputFlowAction> {
        // For now, just use the existing dialog and let it handle cancellation
        // The back button functionality should be handled by the kernel picker UI itself  
        const config = await this.showServerConfigurationDialog();
        
        if (!config) {
            return InputFlowAction.back; // User cancelled, treat as back
        }
        
        return config;
    }
}