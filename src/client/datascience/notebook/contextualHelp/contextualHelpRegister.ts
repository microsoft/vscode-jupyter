import { inject, injectable } from 'inversify';
import { window } from 'vscode';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { UseVSCodeNotebookEditorApi } from '../../../common/constants';
import { IExtensionContext } from '../../../common/types';
import { IContextualHelpProvider } from '../types';

// Responsible for registering our notebook scratch pad
@injectable()
export class ContextualHelpRegister implements IExtensionSingleActivationService {
    constructor(
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IContextualHelpProvider) private helpProvider: IContextualHelpProvider,
        @inject(UseVSCodeNotebookEditorApi) private useVSCodeNotebookEditorApi: boolean
    ) {}

    public async activate() {
        // Only activate this when in the NativeNotebook experiment
        if (this.useVSCodeNotebookEditorApi) {
            this.extensionContext.subscriptions.push(
                window.registerWebviewViewProvider(this.helpProvider.viewType, this.helpProvider, {
                    webviewOptions: { retainContextWhenHidden: true }
                })
            );
        }
    }
}
