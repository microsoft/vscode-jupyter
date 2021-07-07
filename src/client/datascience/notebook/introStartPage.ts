// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationEnvironment, IApplicationShell, IVSCodeNotebook } from '../../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../common/constants';
import { GLOBAL_MEMENTO, IDisposableRegistry, IMemento } from '../../common/types';
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
            this.notify();
        }
    }
    private onDidOpenNotebookDocument(doc: NotebookDocument) {
        if (isJupyterNotebook(doc)) {
            this.notify();
        }
    }
    private notify() {
        if (this.messageDisplayed) {
            return;
        }
        this.messageDisplayed = true;
        this.memento.update(IntroduceNativeNotebookDisplayed, true).then(noop, noop);
        this.appShell
            .showInformationMessage(
                "Welcome to VS Code's new notebook experience!  We think you'll find it faster and more pleasing to use! To learn more, click [here](https://aka.ms/NewNotebookUI)"
            )
            .then(noop, noop);
    }
}
