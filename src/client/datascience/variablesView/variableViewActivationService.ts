import { inject, injectable } from 'inversify';
import { window } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { Experiments } from '../../common/experiments/groups';
import { IExperimentService, IExtensionContext } from '../../common/types';
import { IVariableViewProvider } from './types';

// Responsible for registering our Native Notebook variable view
@injectable()
export class VariableViewActivationService implements IExtensionSingleActivationService {
    constructor(
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IVariableViewProvider) private variableViewProvider: IVariableViewProvider,
        @inject(IExperimentService) private experimentService: IExperimentService
    ) {}

    public async activate() {
        // Only activate this when in the NativeNotebook experiment
        if (await this.experimentService.inExperiment(Experiments.NativeNotebook)) {
            this.extensionContext.subscriptions.push(
                // Don't retain context on the variable view, we don't want to be sending and fetching variables when hidden
                // instead the view just catches up to the current context when made visible
                window.registerWebviewViewProvider(this.variableViewProvider.viewType, this.variableViewProvider, {
                    webviewOptions: { retainContextWhenHidden: false }
                })
            );
        }
    }
}
