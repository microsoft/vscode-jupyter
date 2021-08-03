// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { languages } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationEnvironment, ICommandManager } from '../../common/application/types';
import { NotebookCellScheme, PYTHON_LANGUAGE, UseVSCodeNotebookEditorApi } from '../../common/constants';
import { IDisposableRegistry } from '../../common/types';
import { noop } from '../../common/utils/misc';
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
        @inject(UseVSCodeNotebookEditorApi) private readonly useNativeNb: boolean,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(NotebookCompletionProvider) private readonly completionProvider: NotebookCompletionProvider
    ) {}
    public async activate(): Promise<void> {
        // This condition is temporary.
        // If user belongs to the experiment, then make the necessary changes to package.json.
        // Once the API is final, we won't need to modify the package.json.
        if (this.useNativeNb) {
            this.registerCompletionItemProvider();
            this.disposables.push(new NotebookCellStateTracker());
        } else {
            // Enable command to open in preview notebook (only for insiders).
            if (this.env.channel === 'insiders') {
                await this.commandManager
                    .executeCommand('setContext', 'jupyter.opennotebookInPreviewEditor.enabled', true)
                    .then(noop, noop);
            }
        }
    }

    private registerCompletionItemProvider() {
        const disposable = languages.registerCompletionItemProvider(
            { language: PYTHON_LANGUAGE, scheme: NotebookCellScheme },
            this.completionProvider,
            '.'
        );
        this.disposables.push(disposable);
    }
}
