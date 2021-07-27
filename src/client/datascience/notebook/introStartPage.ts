// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { commands, Memento, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../common/constants';
import { GLOBAL_MEMENTO, IDisposableRegistry, IMemento } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { isJupyterNotebook } from './helpers/helpers';

export const IntroduceNativeNotebookDisplayed = 'JVSC_INTRO_NATIVE_NB_DISPLAYED';

/**
 * Display a notebook introducing Native Notebooks to those users in the stable Notebook experiment & have previously run a notebook.
 */
@injectable()
export class IntroduceNativeNotebookStartPage implements IExtensionSingleActivationService {
    constructor(
        @inject(UseVSCodeNotebookEditorApi) private readonly useVSCNotebook: boolean,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}

    private messageDisplayed?: boolean;
    public async activate(): Promise<void> {
        if (
            this.appEnv.channel !== 'stable' ||
            this.memento.get<boolean>(IntroduceNativeNotebookDisplayed, false) ||
            !this.useVSCNotebook
        ) {
            return;
        }

        this.vscodeNotebook.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables);
        if (this.vscodeNotebook.notebookDocuments.length) {
            void this.notify();
        }
    }
    private onDidOpenNotebookDocument(doc: NotebookDocument) {
        if (isJupyterNotebook(doc)) {
            void this.notify();
        }
    }
    private async notify() {
        if (this.messageDisplayed) {
            return;
        }
        this.messageDisplayed = true;
        this.memento.update(IntroduceNativeNotebookDisplayed, true).then(noop, noop);
        const customizeLayout = DataScience.customizeLayout();
        const selection = await this.appShell.showInformationMessage(DataScience.newNotebookUI(), customizeLayout);
        switch (selection) {
            case customizeLayout: 
                void commands.executeCommand('workbench.action.openSettings', '@tag:notebookLayout').then(noop, noop);
                break;
            default: 
                break;
        }
    }
}
