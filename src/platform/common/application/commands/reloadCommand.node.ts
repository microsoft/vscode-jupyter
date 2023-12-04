// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { Common } from '../../utils/localize';
import { noop } from '../../utils/misc';
import { commands, window } from 'vscode';

/**
 * Prompts user to reload VS Code with a custom message, and reloads if necessary.
 */
@injectable()
export class ReloadVSCodeCommandHandler implements IExtensionSyncActivationService {
    public activate() {
        commands.registerCommand('jupyter.reloadVSCode', this.onReloadVSCode, this);
    }
    private async onReloadVSCode(message: string) {
        const item = await window.showInformationMessage(message, Common.reload);
        if (item === Common.reload) {
            commands.executeCommand('workbench.action.reloadWindow').then(noop, noop);
        }
    }
}
