// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { ICommandManager } from '../../common/application/types';
import { IConfigurationService, IDisposable } from '../../common/types';
import { Commands } from '../constants';
import {
    getDisplayNameOrNameOfKernelConnection,
    isLocalLaunch,
    kernelConnectionMetadataHasKernelModel
} from '../jupyter/kernels/helpers';
import { KernelSelector } from '../jupyter/kernels/kernelSelector';
import { KernelSwitcher } from '../jupyter/kernels/kernelSwitcher';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { IInteractiveWindowProvider, INotebookEditorProvider, INotebookProvider, ISwitchKernelOptions } from '../types';

@injectable()
export class NotebookCommands implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider,
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(INotebookProvider) private readonly notebookProvider: INotebookProvider,
        @inject(KernelSelector) private readonly kernelSelector: KernelSelector,
        @inject(KernelSwitcher) private readonly kernelSwitcher: KernelSwitcher,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}
    public register() {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SwitchJupyterKernel, this.switchKernel, this),
            this.commandManager.registerCommand(Commands.SetJupyterKernel, this.setKernel, this),
            this.commandManager.registerCommand(Commands.NotebookEditorCollapseAllCells, this.collapseAll, this),
            this.commandManager.registerCommand(Commands.NotebookEditorExpandAllCells, this.expandAll, this),
            this.commandManager.registerCommand(Commands.NotebookEditorKeybindSave, this.keybindSave, this),
            this.commandManager.registerCommand(Commands.NotebookEditorKeybindUndo, this.keybindUndo, this),
            this.commandManager.registerCommand(Commands.NotebookEditorToggleOutput, this.toggleOutput, this),
            this.commandManager.registerCommand(Commands.NotebookEditorKeybindExecuteCell, this.executeCell, this),
            this.commandManager.registerCommand(
                Commands.NotebookEditorKeybindRenderMarkdownAndSelectBelow,
                this.renderMarkdownAndSelectBelow,
                this
            )
        );
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private toggleOutput() {
        if (this.notebookEditorProvider.activeEditor?.toggleOutput) {
            this.notebookEditorProvider.activeEditor.toggleOutput();
        }
    }

    private executeCell() {
        void this.commandManager
            .executeCommand('notebook.cell.execute')
            .then(() => this.commandManager.executeCommand('notebook.cell.quitEdit'));
    }

    private renderMarkdownAndSelectBelow() {
        void this.commandManager
            .executeCommand('notebook.cell.quitEdit')
            .then(() => this.commandManager.executeCommand('notebook.cell.executeAndSelectBelow'));
    }

    private collapseAll() {
        if (this.notebookEditorProvider.activeEditor) {
            this.notebookEditorProvider.activeEditor.collapseAllCells();
        }
    }

    private expandAll() {
        if (this.notebookEditorProvider.activeEditor) {
            this.notebookEditorProvider.activeEditor.expandAllCells();
        }
    }

    private keybindSave() {
        if (this.notebookEditorProvider.activeEditor) {
            void this.commandManager.executeCommand(
                'workbench.action.files.save',
                this.notebookEditorProvider.activeEditor.file
            );
        }
    }

    private keybindUndo() {
        void this.commandManager.executeCommand('undo');
    }

    private async switchKernel(options: ISwitchKernelOptions | undefined) {
        // If no identity, spec, or resource, look at the active editor or interactive window.
        // Only one is possible to be active at any point in time
        if (!options) {
            options = this.notebookEditorProvider.activeEditor
                ? {
                      identity: this.notebookEditorProvider.activeEditor.file,
                      resource: this.notebookEditorProvider.activeEditor.file,
                      currentKernelDisplayName:
                          this.notebookEditorProvider.activeEditor.model.metadata?.kernelspec?.display_name ||
                          this.notebookEditorProvider.activeEditor.model.metadata?.kernelspec?.name
                  }
                : {
                      identity: this.interactiveWindowProvider.activeWindow?.identity,
                      resource: this.interactiveWindowProvider.activeWindow?.owner,
                      currentKernelDisplayName: getDisplayNameOrNameOfKernelConnection(
                          this.interactiveWindowProvider.activeWindow?.notebook?.getKernelConnection()
                      )
                  };
        }
        if (options.identity) {
            const isLocal = isLocalLaunch(this.configService);
            // Make sure we have a connection or we can't get remote kernels.
            const connection = isLocal
                ? undefined
                : await this.notebookProvider.connect({
                      getOnly: false,
                      disableUI: false,
                      resource: options.resource
                  });

            // Select a new kernel using the connection information
            const kernel = await this.kernelSelector.selectJupyterKernel(
                options.resource,
                connection,
                undefined,
                options.currentKernelDisplayName
            );
            if (kernel) {
                await this.setKernel(kernel, options.identity, options.resource);
            }
        }
    }

    private async setKernel(kernel: KernelConnectionMetadata, identity: Uri, resource: Uri | undefined) {
        const specOrModel = kernelConnectionMetadataHasKernelModel(kernel) ? kernel.kernelModel : kernel.kernelSpec;
        if (specOrModel) {
            const notebook = await this.notebookProvider.getOrCreateNotebook({
                resource,
                identity,
                getOnly: true
            });

            // If we have a notebook, change its kernel now
            if (notebook) {
                return this.kernelSwitcher.switchKernelWithRetry(notebook, kernel);
            } else {
                this.notebookProvider.firePotentialKernelChanged(identity, kernel);
            }
        }
    }
}
