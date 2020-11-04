import { inject, injectable } from 'inversify';
import { window } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ICommandManager } from '../../common/application/types';
import { ContextKey } from '../../common/contextKey';
import { Experiments } from '../../common/experiments/groups';
import { IExperimentService, IExtensionContext } from '../../common/types';
import { IVariableViewProvider } from './types';

// Responsible for registering our Native Notebook variable view
@injectable()
export class VariableViewActivationService implements IExtensionSingleActivationService {
    constructor(
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IVariableViewProvider) private variableViewProvider: IVariableViewProvider,
        @inject(IExperimentService) private experimentService: IExperimentService,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {}

    public async activate() {
        const context = new ContextKey('jupyter.nativevariableview', this.commandManager);
        if (await this.experimentService.inExperiment(Experiments.NativeVariableView)) {
            context.set(true).ignoreErrors();
            this.extensionContext.subscriptions.push(
                // Consider not using retainContext here? This will save the context of our view, but take more memory in VS Code.
                window.registerWebviewViewProvider(this.variableViewProvider.viewType, this.variableViewProvider, {
                    webviewOptions: { retainContextWhenHidden: true }
                })
            );
        } else {
            context.set(false).ignoreErrors();
        }
    }
}
