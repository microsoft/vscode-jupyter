// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { window } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IExtensionContext } from '../../../platform/common/types';
import { IVariableViewProvider } from './types';

// Responsible for registering our Native Notebook variable view
@injectable()
export class VariableViewActivationService implements IExtensionSyncActivationService {
    constructor(
        @inject(IExtensionContext) private extensionContext: IExtensionContext,
        @inject(IVariableViewProvider) private variableViewProvider: IVariableViewProvider
    ) {}

    public activate() {
        this.extensionContext.subscriptions.push(
            // Don't retain context on the variable view, we don't want to be sending and fetching variables when hidden
            // instead the view just catches up to the current context when made visible
            window.registerWebviewViewProvider(this.variableViewProvider.viewType, this.variableViewProvider, {
                webviewOptions: { retainContextWhenHidden: false }
            })
        );
    }
}
