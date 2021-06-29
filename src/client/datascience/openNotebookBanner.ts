import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../activation/types';
import { IPythonExtensionChecker } from '../api/types';
import { isUntitledFile } from '../common/utils/misc';
import { isPythonNotebook } from './notebook/helpers/helpers';
import { INotebookEditor, INotebookEditorProvider } from './types';

@injectable()
export class OpenNotebookBanner implements IExtensionSingleActivationService {
    constructor(
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider,
        @inject(IPythonExtensionChecker) private pythonExtensionChecker: IPythonExtensionChecker
    ) { }

    public async activate() {
        this.notebookEditorProvider.onDidOpenNotebookEditor(this.openedNotebook.bind(this));
    }

    private async openedNotebook(editor: INotebookEditor) {
        if (
            !this.pythonExtensionChecker.isPythonExtensionInstalled &&
            editor.notebookMetadata?.kernelspec &&
            isPythonNotebook(editor.notebookMetadata) &&
            !isUntitledFile(editor.file)
        ) {
            await this.pythonExtensionChecker.showPythonExtensionInstallRecommendedPrompt();
        }
    }
}
