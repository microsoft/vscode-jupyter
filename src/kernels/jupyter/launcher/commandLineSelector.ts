// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
// eslint-disable-next-line
import { ConfigurationChangeEvent } from 'vscode';
import { IWorkspaceService, IApplicationShell, ICommandManager } from '../../../platform/common/application/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';

/**
 * Provide a quick pick to let a user select command line options for starting jupyter
 */
@injectable()
export class JupyterCommandLineSelector {
    constructor(
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {
        workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this));
    }

    private async onDidChangeConfiguration(e: ConfigurationChangeEvent) {
        if (e.affectsConfiguration('jupyter.jupyterCommandLineArguments')) {
            const reload = DataScience.jupyterCommandLineReloadAnswer();
            const item = await this.appShell.showInformationMessage(
                DataScience.jupyterCommandLineReloadQuestion(),
                reload
            );
            if (item === reload) {
                this.commandManager.executeCommand('workbench.action.reloadWindow').then(noop, noop);
            }
        }
    }
}
