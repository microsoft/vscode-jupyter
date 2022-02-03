// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { ICommandManager } from '../../common/application/types';
import { IDisposable } from '../../common/types';
import { Commands } from '../constants';
import { JupyterServerSelector } from '../jupyter/serverSelector';
import { traceInfo } from '../../common/logger';

@injectable()
export class JupyterServerSelectorCommand implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector
    ) { }
    public register() {
        this.disposables.push(
            this.commandManager.registerCommand(
                Commands.SelectJupyterURI,
                (local: boolean = true, userUri: string | undefined, source: 'nativeNotebookStatusBar' | 'commandPalette' | 'toolbar' = 'commandPalette') => {

                    if (!local && userUri) {
                        traceInfo(`Setting Jupyter Server URI to remote: ${userUri}`);
                        this.serverSelector.setJupyterURIToRemote(userUri)
                        return

                        this.serverSelector.setJupyterURIToLocal
                    }

                    // Activate UI Selector
                    this.serverSelector.selectJupyterURI(local, source)
                },
                this.serverSelector
            )
        );
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
}
