import { inject, injectable } from 'inversify';
import { window } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IExtensionContext } from '../../common/types';
import { IVariableViewProvider } from './types';

// Responsible for registering our Native Notebook variable view
@injectable()
export class VariableViewActivationService implements IExtensionSingleActivationService {
    constructor(
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IVariableViewProvider) private variableViewProvider: IVariableViewProvider
    ) {}

    public async activate() {
        this.extensionContext.subscriptions.push(
            // IANHU: Consider not using retainContext here?
            window.registerWebviewViewProvider(this.variableViewProvider.viewType, this.variableViewProvider, {
                webviewOptions: { retainContextWhenHidden: true }
            })
        );
    }
}
