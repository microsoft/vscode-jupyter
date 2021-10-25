// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { languages } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { NOTEBOOK_SELECTOR } from '../../common/constants';
import { IDisposableRegistry } from '../../common/types';
import { JupyterCompletionProvider } from './intellisense/jupyterCompletionProvider';

/**
 * This class basically registers the necessary providers and the like with VSC.
 * I.e. this is where we integrate our stuff with VS Code via their extension endpoints.
 */
@injectable()
export class NotebookIntegration implements IExtensionSingleActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(JupyterCompletionProvider) private readonly completionProvider: JupyterCompletionProvider
    ) {}
    public async activate(): Promise<void> {
        this.registerCompletionItemProvider();
    }

    private registerCompletionItemProvider() {
        const disposable = languages.registerCompletionItemProvider(
            NOTEBOOK_SELECTOR,
            this.completionProvider,
            '.',
            '"',
            "'",
            ','
        );
        this.disposables.push(disposable);
    }
}
