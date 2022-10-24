// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { NotebookDocument, window } from 'vscode';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { Commands } from '../../../platform/common/constants';
import { ContextKey } from '../../../platform/common/contextKey';
import { IConfigurationService, IDisposableRegistry } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { INotebookKernelSourceSelector } from '../types';

// Command that we will place into the kernel picker to determine what the controller source is for this document
@injectable()
export class PickDocumentKernelSourceCommand implements IExtensionSingleActivationService {
    private showPickDocumentKernelSourceContext: ContextKey;
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(INotebookKernelSourceSelector) private readonly kernelSourceSelector: INotebookKernelSourceSelector
    ) {
        // Context keys to control when these commands are shown
        this.showPickDocumentKernelSourceContext = new ContextKey(
            'jupyter.pickDocumentKernelSourceContext',
            this.commandManager
        );
    }

    public async activate(): Promise<void> {
        // Register for config changes
        this.disposables.push(this.configService.getSettings().onDidChange(this.updateVisibility));

        // Register our command to execute
        this.disposables.push(
            this.commandManager.registerCommand(Commands.PickDocumentKernelSource, this.pickDocumentKernelSource, this)
        );

        this.updateVisibility();
    }

    private async pickDocumentKernelSource(notebook?: NotebookDocument) {
        const targetNotebook = notebook || window.activeNotebookEditor?.notebook;
        if (targetNotebook && this.configService.getSettings().kernelPickerType === 'Insiders') {
            await this.kernelSourceSelector.selectKernelSource(targetNotebook);
        }
    }

    // Only show this command if we are in our Insiders picker type
    private updateVisibility() {
        if (this.configService.getSettings().kernelPickerType === 'Insiders') {
            this.showPickDocumentKernelSourceContext.set(true).then(noop, noop);
        } else {
            this.showPickDocumentKernelSourceContext.set(false).then(noop, noop);
        }
    }
}
