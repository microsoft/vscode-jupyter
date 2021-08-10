// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { languages } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { NotebookCellScheme, PYTHON_LANGUAGE } from '../../common/constants';
import { IDisposableRegistry } from '../../common/types';
import { NotebookCellStateTracker } from './helpers/helpers';
import { NotebookCompletionProvider } from './intellisense/completionProvider';

export const HAS_EXTENSION_CONFIGURED_CELL_TOOLBAR_SETTING = 'CELL_TOOLBAR_SETTING_MEMENTO_KEY';

/**
 * This class basically registers the necessary providers and the like with VSC.
 * I.e. this is where we integrate our stuff with VS Code via their extension endpoints.
 */
@injectable()
export class NotebookIntegration implements IExtensionSingleActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(NotebookCompletionProvider) private readonly completionProvider: NotebookCompletionProvider
    ) {}
    public async activate(): Promise<void> {
        this.registerCompletionItemProvider();
        this.disposables.push(new NotebookCellStateTracker());
    }

    private registerCompletionItemProvider() {
        const disposable = languages.registerCompletionItemProvider(
            { language: PYTHON_LANGUAGE, scheme: NotebookCellScheme },
            this.completionProvider,
            '.',
            '"',
            "'",
            ','
        );
        this.disposables.push(disposable);
    }
}
