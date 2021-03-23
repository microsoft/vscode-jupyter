// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { StatusBarAlignment, StatusBarItem } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationShell, ICommandManager, IDocumentManager, IVSCodeNotebook } from '../../common/application/types';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { Commands, Settings } from '../constants';
import { JupyterServerSelector } from '../jupyter/serverSelector';
import { IJupyterServerUriStorage } from '../types';
import { isJupyterNotebook } from './helpers/helpers';

@injectable()
export class RemoteSwitcher implements IExtensionSingleActivationService {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector
    ) {
        this.disposableRegistry.push(this);
    }
    private statusBarItem!: StatusBarItem;
    public dispose() {
        this.disposables.forEach((item) => item.dispose());
    }
    public async activate(): Promise<void> {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SelectNativeJupyterUriFromToolBar, this.onToolBarCommand, this)
        );
        // Set priority of 1000 to ensure it is to the left of the VSC Kernel statusbar item.
        this.statusBarItem = this.appShell.createStatusBarItem(StatusBarAlignment.Right, 1000);
        this.notebook.onDidChangeActiveNotebookEditor(this.updateStatusBar.bind(this), this.disposables);
        this.documentManager.onDidChangeActiveTextEditor(this.updateStatusBar.bind(this), this.disposables);
        this.serverUriStorage.onDidChangeUri(this.updateStatusBar.bind(this), this.disposables);
        this.disposables.push(this.statusBarItem);
        this.updateStatusBar().catch(noop);
    }
    private async onToolBarCommand() {
        await this.serverSelector.selectJupyterURI(true, 'nativeNotebookToolbar');
    }
    private async updateStatusBar() {
        if (!this.notebook.activeNotebookEditor || !isJupyterNotebook(this.notebook.activeNotebookEditor.document)) {
            this.statusBarItem.hide();
            return;
        }
        this.statusBarItem.show();
        const uri = await this.serverUriStorage.getUri();
        const label =
            uri === Settings.JupyterServerLocalLaunch
                ? DataScience.jupyterNativeNotebookUriStatusLabelForLocal()
                : DataScience.jupyterNativeNotebookUriStatusLabelForRemote();
        const tooltipSuffix = uri === Settings.JupyterServerLocalLaunch ? '' : ` (${uri})`;
        const tooltip = `${DataScience.specifyLocalOrRemoteJupyterServerForConnections()}${tooltipSuffix}`;
        this.statusBarItem.text = `$(debug-disconnect) ${label}`;
        this.statusBarItem.tooltip = tooltip;
        this.statusBarItem.command = {
            command: Commands.SelectJupyterURI,
            title: label,
            tooltip,
            arguments: [undefined, 'nativeNotebookStatusBar']
        };
        this.statusBarItem.command;
    }
}
