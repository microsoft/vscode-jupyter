// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../../platform/activation/types';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { IDisposable } from '../../../platform/common/types';
import { JupyterCommandLineSelectorCommand } from './commandLineSelector';
import { JupyterServerSelectorCommand } from '../../../notebooks/serverSelector';

@injectable()
export class CommandRegistry implements IExtensionSingleActivationService {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(JupyterServerSelectorCommand) private readonly serverSelectedCommand: JupyterServerSelectorCommand,
        @inject(JupyterCommandLineSelectorCommand)
        private readonly commandLineCommand: JupyterCommandLineSelectorCommand,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
        this.disposables.push(this.serverSelectedCommand);
    }
    public async activate() {
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
        this.serverSelectedCommand.register();
    }
}
