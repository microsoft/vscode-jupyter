// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IWorkspaceService } from '../../client/common/application/types';

import { IDisposable } from '../../client/common/types';
import { JupyterCommandLineSelectorCommand } from './commandLineSelector';
import { JupyterServerSelectorCommand } from './serverSelector';

@injectable()
export class CommandRegistry implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(JupyterServerSelectorCommand) private readonly serverSelectedCommand: JupyterServerSelectorCommand,
        @inject(JupyterCommandLineSelectorCommand)
        private readonly commandLineCommand: JupyterCommandLineSelectorCommand,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
        this.disposables.push(this.serverSelectedCommand);
    }
    public register() {
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
