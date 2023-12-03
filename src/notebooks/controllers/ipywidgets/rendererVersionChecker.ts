// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { commands, extensions, NotebookDocumentChangeEvent, window, workspace } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { RendererExtension, WIDGET_MIMETYPE } from '../../../platform/common/constants';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { isJupyterNotebook } from '../../../platform/common/utils';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';

@injectable()
export class RendererVersionChecker implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    static messageDisplayed: boolean = false;
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        disposables.push(this);
    }
    dispose(): void {
        dispose(this.disposables);
    }
    activate(): void {
        workspace.onDidChangeNotebookDocument(this.onDidChangeNotebookDocument, this, this.disposables);
    }
    private onDidChangeNotebookDocument(e: NotebookDocumentChangeEvent) {
        if (!isJupyterNotebook(e.notebook)) {
            return;
        }
        if (
            !e.cellChanges.some(
                (c) =>
                    c.outputs && c.outputs.some((o) => o.items && o.items.some((item) => item.mime === WIDGET_MIMETYPE))
            )
        ) {
            return;
        }
        this.checkRendererExtensionVersion();
    }
    /**
     * Verify we a minimum of 1.0.15 version of the renderer extension.
     */
    private checkRendererExtensionVersion() {
        if (!workspace.isTrusted) {
            return;
        }

        const rendererExtension = extensions.getExtension(RendererExtension);
        if (!rendererExtension) {
            this.displayNotInstalledMessage();
            return;
        }
        const version = rendererExtension.packageJSON.version;
        if (!version) {
            this.displayUpdateMessage();
            return;
        }
        const parts = version.split('.');
        const major = parseInt(parts[0], 10);
        const minor = parseInt(parts[1], 10);
        const patch = parseInt(parts[2], 10);
        if (major < 1 || (major === 1 && minor === 0 && patch < 15)) {
            this.displayUpdateMessage();
        }
    }
    private displayNotInstalledMessage() {
        if (RendererVersionChecker.messageDisplayed) {
            return;
        }
        RendererVersionChecker.messageDisplayed = true;
        window
            .showInformationMessage(DataScience.rendererExtensionRequired, { modal: true }, Common.bannerLabelYes)
            .then((answer) => {
                if (answer === Common.bannerLabelYes) {
                    commands.executeCommand('extension.open', RendererExtension).then(noop, noop);
                }
            })
            .then(noop, noop);
    }
    public displayUpdateMessage() {
        if (RendererVersionChecker.messageDisplayed) {
            return;
        }
        RendererVersionChecker.messageDisplayed = true;
        window
            .showInformationMessage(DataScience.rendererExtension1015Required, { modal: true }, Common.bannerLabelYes)
            .then((answer) => {
                if (answer === Common.bannerLabelYes) {
                    commands.executeCommand('extension.open', RendererExtension).then(noop, noop);
                }
            })
            .then(noop, noop);
    }
}
