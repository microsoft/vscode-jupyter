// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { IDisposable } from '../../../platform/common/types';
import { JupyterCommandLineSelectorCommand } from './commandLineSelector';

/**
 * Registers jupyter (non ZMQ) specific commands
 */
@injectable()
export class CommandRegistry implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(JupyterCommandLineSelectorCommand)
        private readonly commandLineCommand: JupyterCommandLineSelectorCommand,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}
    public activate() {
        this.registerCommandsIfTrusted();
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    private registerCommandsIfTrusted() {
        if (!this.workspace.isTrusted) {
            return;
        }
        this.commandLineCommand.register();
    }
}
