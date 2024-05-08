// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget, NotebookCell, window, workspace } from 'vscode';
import { IConfigurationService } from '../../platform/common/types';

export class InteractiveExecutionPrompt {
    private disabled = false;

    constructor(private readonly configurationService: IConfigurationService) {}

    public async checkToPrompt(cell: NotebookCell) {
        if (this.disabled) {
            return;
        }
        if (cell.notebook.notebookType === 'interactive' && !cell.metadata.interactive) {
            const settings = this.configurationService.getSettings(cell.document.uri);
            const config = workspace.getConfiguration('interactiveWindow');

            // can we check if the keybinding for interactive.execute is set to 'enter'?
            if (!settings.promptToChangeInteractiveExecute || config.get('interactiveShiftEnter')) {
                return;
            }

            const response = await window.showInformationMessage(
                'Would you like to have `shift+enter` execute input and `enter` create a new line? (previous behavior)',
                'shift+enter to execute',
                'enter to execute'
            );
            switch (response) {
                case 'shift+enter to execute': {
                    await config.update('executeWithShiftEnter', true, ConfigurationTarget.Global);
                    await this.configurationService.updateSetting('promptToChangeInteractiveExecute', false);
                    break;
                }
                case 'enter to execute': {
                    await this.configurationService.updateSetting('promptToChangeInteractiveExecute', false);
                    break;
                }
                default:
                    {
                    }

                    this.disabled = true;
            }
        }
    }
}
