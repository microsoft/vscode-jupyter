// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { CancellationTokenSource, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IVSCodeNotebook, IWorkspaceService } from '../../common/application/types';
import { traceError, traceInfo } from '../../common/logger';
import { IConfigurationService, IDisposableRegistry } from '../../common/types';
import { DisplayOptions } from '../displayOptions';
import { isJupyterNotebook } from '../notebook/helpers/helpers';
import { IInteractiveWindow, IInteractiveWindowProvider, INotebookCreationTracker, INotebookProvider } from '../types';

@injectable()
export class ServerPreload implements IExtensionSingleActivationService {
    constructor(
        @inject(INotebookCreationTracker)
        private readonly tracker: INotebookCreationTracker,
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @inject(IInteractiveWindowProvider) private interactiveProvider: IInteractiveWindowProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        notebook.onDidOpenNotebookDocument(this.onDidOpenNotebook.bind(this), this, disposables);
        this.interactiveProvider.onDidChangeActiveInteractiveWindow(this.onDidOpenOrCloseInteractive.bind(this));
    }
    public activate(): Promise<void> {
        // This is the list of things that should cause us to start a local server
        // 1) Notebook is opened
        // 2) Notebook was opened in the past 7 days
        // 3) Interactive window was opened in the past 7 days
        // 4) Interactive window is opened
        // And the user has specified local server in their settings.
        this.checkDateForServerStart();

        // Don't hold up activation though
        return Promise.resolve();
    }

    private checkDateForServerStart() {
        if (this.shouldAutoStartStartServer(this.tracker.lastNotebookCreated)) {
            this.createServerIfNecessary().ignoreErrors();
        }
    }
    private shouldAutoStartStartServer(lastTime?: Date) {
        if (!lastTime) {
            return false;
        }
        const currentTime = new Date();
        const diff = currentTime.getTime() - lastTime.getTime();
        const diffInDays = Math.floor(diff / (24 * 3600 * 1000));
        return diffInDays <= 7;
    }

    private async createServerIfNecessary() {
        if (!this.workspace.isTrusted) {
            return;
        }
        const source = new CancellationTokenSource();
        const ui = new DisplayOptions(true);
        try {
            traceInfo(`Attempting to start a server because of preload conditions ...`);

            // If it didn't start, attempt for local and if allowed.
            if (!this.configService.getSettings(undefined).disableJupyterAutoStart) {
                // Local case, try creating one
                await this.notebookProvider.connect({
                    resource: undefined,
                    ui,
                    localJupyter: true,
                    token: source.token
                });
            }
        } catch (exc) {
            traceError(`Error starting server in serverPreload: `, exc);
        } finally {
            ui.dispose();
            source.dispose();
        }
    }

    private onDidOpenNotebook(doc: NotebookDocument) {
        if (!isJupyterNotebook(doc)) {
            return;
        }
        // Automatically start a server whenever we open a notebook
        this.createServerIfNecessary().ignoreErrors();
    }

    private onDidOpenOrCloseInteractive(interactive: IInteractiveWindow | undefined) {
        if (interactive) {
            this.createServerIfNecessary().ignoreErrors();
        }
    }
}
