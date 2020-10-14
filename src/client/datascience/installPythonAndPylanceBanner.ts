import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationShell } from '../common/application/types';
import { PythonAndPylanceExtensionBanner } from '../common/utils/localize';
import { isPythonNotebook } from './notebook/helpers/helpers';
import { INotebookEditor, INotebookEditorProvider } from './types';

@injectable()
export class InstallPythonAndPylanceBanner implements IExtensionSingleActivationService {
    constructor(
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider,
        @inject(IApplicationShell) private appShell: IApplicationShell
    ) {}

    public async activate() {
        this.notebookEditorProvider.onDidOpenNotebookEditor(this.openedNotebook.bind(this));
    }

    private async openedNotebook(editor: INotebookEditor) {
        if (editor.model.metadata && isPythonNotebook(editor.model.metadata)) {
            await this.appShell.showInformationMessage(PythonAndPylanceExtensionBanner.message());
        }
    }
}
