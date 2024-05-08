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
            const setting = config.get('executeWithShiftEnter');

            // can we check if the keybinding for interactive.execute is set to 'enter'?
            if (!settings.promptToChangeInteractiveExecute || setting === undefined || setting === true) {
                return;
            }

            const response = await window.showInformationMessage(
                'Change execute keyboard shortcut to shift+enter? (previous behavior)',
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
