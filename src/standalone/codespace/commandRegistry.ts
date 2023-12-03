// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { Commands } from '../../platform/common/constants';
import { commands, workspace } from 'vscode';
import { ICommandNameArgumentTypeMapping } from '../../commands';

@injectable()
export class CommandRegistry implements IDisposable, IExtensionSyncActivationService {
    constructor(@inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry) {}
    activate() {
        this.registerCommandsIfTrusted();
    }
    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private registerCommandsIfTrusted() {
        if (!workspace.isTrusted) {
            return;
        }

        this.registerCommand(Commands.ContinueEditSessionInCodespace, this.continueEditSessionInCodespace);
    }

    private registerCommand<
        E extends keyof ICommandNameArgumentTypeMapping,
        U extends ICommandNameArgumentTypeMapping[E]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    >(command: E, callback: (...args: U) => any) {
        const disposable = commands.registerCommand(command, callback, this);
        this.disposables.push(disposable);
    }

    private async continueEditSessionInCodespace() {
        await commands.executeCommand(
            '_workbench.editSessions.actions.continueEditSession.github.codespaces.continueEditSessionInCodespaceWithJupyterServer'
        );
    }
}
