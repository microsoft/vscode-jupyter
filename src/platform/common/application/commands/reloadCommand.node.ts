// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { Common } from '../../utils/localize';
import { noop } from '../../utils/misc';
import { ICommandManager } from '../types';
import { window } from 'vscode';

/**
 * Prompts user to reload VS Code with a custom message, and reloads if necessary.
 */
@injectable()
export class ReloadVSCodeCommandHandler implements IExtensionSyncActivationService {
    constructor(@inject(ICommandManager) private readonly commandManager: ICommandManager) {}
    public activate() {
        this.commandManager.registerCommand('jupyter.reloadVSCode', this.onReloadVSCode, this);
    }
    private async onReloadVSCode(message: string) {
        const item = await window.showInformationMessage(message, Common.reload);
        if (item === Common.reload) {
            this.commandManager.executeCommand('workbench.action.reloadWindow').then(noop, noop);
        }
    }
}
