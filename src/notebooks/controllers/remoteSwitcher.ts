// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { StatusBarAlignment, StatusBarItem } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import {
    IDocumentManager,
    IVSCodeNotebook,
    ICommandManager,
    IApplicationShell
} from '../../platform/common/application/types';
import { IDisposable, IDisposableRegistry, IFeaturesManager } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { Commands } from '../../platform/common/constants';
import { JupyterServerSelector } from '../../kernels/jupyter/connection/serverSelector';
import { IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import { Settings } from '../../platform/common/constants';
import { isJupyterNotebook } from '../../platform/common/utils';
import { noop } from '../../platform/common/utils/misc';
import { IControllerRegistration } from './types';

/**
 * Implements the UI for the status bar that says 'Jupyter:Local' or 'Jupyter:Remote'
 */
@injectable()
export class RemoteSwitcher implements IExtensionSyncActivationService {
    private disposables: IDisposable[] = [];
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(IControllerRegistration) private readonly controllerRegistration: IControllerRegistration,
        @inject(IFeaturesManager) private readonly featuresManager: IFeaturesManager
    ) {
        this.disposableRegistry.push(this);
    }
    private statusBarItem!: StatusBarItem;
    public dispose() {
        this.disposables.forEach((item) => item.dispose());
    }
    public activate() {
        const updatePerFeature = () => {
            if (this.featuresManager.features.kernelPickerType === 'Insiders') {
                this.disposables.forEach((item) => item.dispose());
                this.disposables = [];
            } else {
                this._registerStatusBar();
            }
        };

        this.disposableRegistry.push(this.featuresManager.onDidChangeFeatures(() => updatePerFeature()));
        updatePerFeature();
    }

    private _registerStatusBar() {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SelectNativeJupyterUriFromToolBar, this.onToolBarCommand, this)
        );
        // Set priority of 1000 to ensure it is to the left of the VSC Kernel statusbar item.
        this.statusBarItem = this.appShell.createStatusBarItem(StatusBarAlignment.Right, 1000);
        this.notebook.onDidChangeActiveNotebookEditor(this.updateStatusBar.bind(this), this.disposables);
        this.documentManager.onDidChangeActiveTextEditor(this.updateStatusBar.bind(this), this.disposables);
        this.serverUriStorage.onDidChangeUri(this.updateStatusBar.bind(this), this.disposables);
        this.controllerRegistration.onControllerSelected(this.updateStatusBar.bind(this), this, this.disposables);
        this.disposables.push(this.statusBarItem);
        this.updateStatusBar().catch(noop);
    }
    private async onToolBarCommand() {
        await this.serverSelector.selectJupyterURI('nativeNotebookToolbar');
    }
    private async updateStatusBar() {
        if (!this.notebook.activeNotebookEditor || !isJupyterNotebook(this.notebook.activeNotebookEditor.notebook)) {
            this.statusBarItem.hide();
            return;
        }
        this.statusBarItem.show();
        const uri = await this.serverUriStorage.getRemoteUri();
        const label =
            !uri || !uri.isValidated || uri.uri === Settings.JupyterServerLocalLaunch
                ? DataScience.jupyterNativeNotebookUriStatusLabelForLocal
                : DataScience.jupyterNativeNotebookUriStatusLabelForRemote;
        const tooltipSuffix = uri?.uri === Settings.JupyterServerLocalLaunch ? '' : ` (${uri})`;
        const tooltip = `${DataScience.specifyLocalOrRemoteJupyterServerForConnections}${tooltipSuffix}`;
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
