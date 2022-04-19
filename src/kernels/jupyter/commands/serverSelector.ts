// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { NotebookDocument, Uri } from 'vscode';
import { INotebookControllerManager } from '../../../notebooks/types';
import { ICommandManager } from '../../../platform/common/application/types';
import { Commands } from '../../../platform/common/constants';
import { IDisposable } from '../../../platform/common/types';
import { traceInfo } from '../../../platform/logging';
import { JupyterServerSelector } from '../serverSelector';
import { IJupyterServerUriStorage } from '../types';

@injectable()
export class JupyterServerSelectorCommand implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(INotebookControllerManager) private readonly controllerManager: INotebookControllerManager
    ) {}
    public register() {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SelectJupyterURI, this.selectJupyterUri, this)
        );
        this.disposables.push(
            this.commandManager.registerCommand(Commands.ClearSavedJupyterUris, this.clearJupyterUris, this)
        );
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private async selectJupyterUri(
        local: boolean = true,
        source: Uri | 'nativeNotebookStatusBar' | 'commandPalette' | 'toolbar' = 'commandPalette',
        notebook: NotebookDocument | undefined
    ): Promise<undefined | string> {
        if (source instanceof Uri) {
            traceInfo(`Setting Jupyter Server URI to remote: ${source}`);

            // Set the uri directly
            await this.serverSelector.setJupyterURIToRemote(source.toString(true));

            // Find one that is the default for this remote
            if (notebook) {
                // Recompute the preferred controller
                await this.controllerManager.computePreferredNotebookController(notebook);

                // That should have picked a preferred
                const preferred = this.controllerManager.getPreferredNotebookController(notebook);
                if (preferred) {
                    return preferred.id;
                }
            }
            return undefined;
        }

        // Activate UI Selector
        void this.serverSelector.selectJupyterURI(local, source);
    }

    private async clearJupyterUris(): Promise<void> {
        return this.serverUriStorage.clearUriList();
    }
}
