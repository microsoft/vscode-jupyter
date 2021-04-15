import { inject, injectable } from 'inversify';
import { window } from 'vscode';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { UseVSCodeNotebookEditorApi } from '../../../common/constants';
import { IExtensionContext } from '../../../common/types';
import { IScratchPadProvider } from '../types';

// Responsible for registering our notebook scratch pad
@injectable()
export class ScratchPadRegister implements IExtensionSingleActivationService {
    constructor(
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IScratchPadProvider) private scratchPadProvider: IScratchPadProvider,
        @inject(UseVSCodeNotebookEditorApi) private useVSCodeNotebookEditorApi: boolean
    ) {}

    public async activate() {
        // Only activate this when in the NativeNotebook experiment
        if (this.useVSCodeNotebookEditorApi) {
            this.extensionContext.subscriptions.push(
                window.registerWebviewViewProvider(this.scratchPadProvider.viewType, this.scratchPadProvider, {
                    webviewOptions: { retainContextWhenHidden: true }
                })
            );
        }
    }
}
