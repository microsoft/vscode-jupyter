import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { IPythonExtensionChecker } from '../api/types';
import { IApplicationEnvironment, IApplicationShell } from '../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../common/constants';
import { GLOBAL_MEMENTO, IMemento } from '../common/types';
import { DataScience } from '../common/utils/localize';
import { isPythonNotebook } from './notebook/helpers/helpers';
import { INotebookEditor, INotebookEditorProvider } from './types';

const ShowedKernelMessageKey = 'ShowedKernelLocationMessage';

@injectable()
export class OpenNotebookBanner implements IExtensionSingleActivationService {
    constructor(
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider,
        @inject(IPythonExtensionChecker) private pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IApplicationEnvironment) private appEnv: IApplicationEnvironment,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(UseVSCodeNotebookEditorApi) private useVSCodeNotebookEditor: boolean,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private mementoStorage: Memento
    ) {}

    public async activate() {
        this.notebookEditorProvider.onDidOpenNotebookEditor(this.openedNotebook.bind(this));
    }

    private async openedNotebook(editor: INotebookEditor) {
        if (
            !this.pythonExtensionChecker.isPythonExtensionInstalled &&
            editor.model.metadata &&
            isPythonNotebook(editor.model.metadata)
        ) {
            await this.pythonExtensionChecker.showPythonExtensionInstallRecommendedPrompt();
        } else if (
            this.appEnv.channel === 'stable' &&
            this.useVSCodeNotebookEditor &&
            !this.mementoStorage.get(ShowedKernelMessageKey, false)
        ) {
            // In order to prevent two notifications appearing, only put up the kernel prompt if not putting up the first one
            await this.mementoStorage.update(ShowedKernelMessageKey, true);
            void this.appShell.showInformationMessage(DataScience.kernelTipMessage());
        }
    }
}
