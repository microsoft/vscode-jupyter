// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { ICommandManager, IWorkspaceService } from '../../platform/common/application/types';
import { Commands } from '../../platform/common/constants';
import { commands } from 'vscode';
import { ICommandNameArgumentTypeMapping } from '../../commands';

@injectable()
export class CommandRegistry implements IDisposable, IExtensionSyncActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {}
    activate() {
        this.registerCommandsIfTrusted();
    }
    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private registerCommandsIfTrusted() {
        if (!this.workspace.isTrusted) {
            return;
        }

        this.registerCommand(Commands.ContinueEditSessionInCodespace, this.continueEditSessionInCodespace);
    }

    private registerCommand<
        E extends keyof ICommandNameArgumentTypeMapping,
        U extends ICommandNameArgumentTypeMapping[E]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    >(command: E, callback: (...args: U) => any) {
        const disposable = this.commandManager.registerCommand(command, callback, this);
        this.disposables.push(disposable);
    }

    private async continueEditSessionInCodespace() {
        await commands.executeCommand(
            '_workbench.editSessions.actions.continueEditSession.github.codespaces.continueEditSessionInCodespaceWithJupyterServer'
        );
    }
}
