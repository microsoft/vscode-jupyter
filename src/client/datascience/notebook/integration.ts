// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import { ConfigurationTarget, languages, Memento, NotebookContentProvider as VSCNotebookContentProvider } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import {
    IApplicationEnvironment,
    ICommandManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../common/application/types';
import { NotebookCellScheme, PYTHON_LANGUAGE, UseVSCodeNotebookEditorApi } from '../../common/constants';
import { traceError } from '../../common/logger';
import { GLOBAL_MEMENTO, IDisposableRegistry, IMemento } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { JupyterNotebookView } from './constants';
import { isJupyterNotebook, NotebookCellStateTracker } from './helpers/helpers';
import { NotebookCompletionProvider } from './intellisense/completionProvider';
import { INotebookContentProvider } from './types';

export const HAS_EXTENSION_CONFIGURED_CELL_TOOLBAR_SETTING = 'CELL_TOOLBAR_SETTING_MEMENTO_KEY';

/**
 * This class basically registers the necessary providers and the like with VSC.
 * I.e. this is where we integrate our stuff with VS Code via their extension endpoints.
 */
@injectable()
export class NotebookIntegration implements IExtensionSingleActivationService {
    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(UseVSCodeNotebookEditorApi) private readonly useNativeNb: boolean,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookContentProvider) private readonly notebookContentProvider: VSCNotebookContentProvider,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(NotebookCompletionProvider) private readonly completionProvider: NotebookCompletionProvider,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento
    ) {}
    public async activate(): Promise<void> {
        // This condition is temporary.
        // If user belongs to the experiment, then make the necessary changes to package.json.
        // Once the API is final, we won't need to modify the package.json.
        if (this.useNativeNb) {
            this.registerCompletionItemProvider();
            this.disposables.push(new NotebookCellStateTracker());
            await this.enableNotebooks();
        } else {
            // Enable command to open in preview notebook (only for insiders).
            if (this.env.channel === 'insiders') {
                await this.commandManager
                    .executeCommand('setContext', 'jupyter.opennotebookInPreviewEditor.enabled', true)
                    .then(noop, noop);
            }
            // Possible user was in experiment, then they opted out. In this case we need to revert the changes made to the settings file.
            // Again, this is temporary code.
            await this.disableNotebooks();
        }
        if (this.useNativeNb) {
            try {
                this.disposables.push(
                    this.vscNotebook.registerNotebookContentProvider(
                        JupyterNotebookView,
                        this.notebookContentProvider,
                        {
                            transientOutputs: false,
                            transientCellMetadata: {
                                breakpointMargin: true,
                                inputCollapsed: true,
                                outputCollapsed: true,
                                custom: false
                            }
                        }
                    )
                );
            } catch (ex) {
                // If something goes wrong, and we're not in Insiders & not using the NativeEditor experiment, then swallow errors.
                traceError('Failed to register VS Code Notebook API', ex);
                if (this.useNativeNb) {
                    throw ex;
                }
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
    private async enableNotebooks() {
        await this.enableDisableEditorAssociation(true);
        await this.moveCellToolbarToLeft();
    }

    // By default we want Jupyter extension native notebook users to get the cell toolbar
    // on the left, unless the user has already customized it before we get to update it.
    private async moveCellToolbarToLeft() {
        const extensionHasUpdatedSetting = this.globalState.get<boolean | undefined>(
            HAS_EXTENSION_CONFIGURED_CELL_TOOLBAR_SETTING
        );
        if (extensionHasUpdatedSetting) {
            // Jupyter extension has already customized setting. Don't customize it again
            return;
        }
        await this.globalState.update(HAS_EXTENSION_CONFIGURED_CELL_TOOLBAR_SETTING, true);

        // Jupyter extension hasn't customized this setting yet, but it's possible the user
        // already changed it on their own.
        // Make sure we don't overwrite the user's existing customization for this setting
        const settings = this.workspace.getConfiguration('notebook', undefined);
        const toolbarSettings = settings.get('cellToolbarLocation') as {
            [key: string]: 'left' | 'right' | 'hidden';
        };
        const userCustomizedSetting = JupyterNotebookView in toolbarSettings;
        if (userCustomizedSetting) {
            // Regardless of what the user set this to, we should honor it
            return;
        }
        toolbarSettings[JupyterNotebookView] = 'left';
        await settings.update('cellToolbarLocation', toolbarSettings, ConfigurationTarget.Global);
    }

    private async enableDisableEditorAssociation(shouldEnableNativeNotebooksAssociation: boolean) {
        // This code is temporary.
        const settings = this.workspace.getConfiguration('workbench', undefined);
        const editorAssociations = settings.get('editorAssociations'); // At this point we don't know if this is the old or new format
        const updatedSettings = ensureUpdatedEditorAssociationSettingFormat(
            editorAssociations
        ) as NewEditorAssociationSetting;
        const currentAssociation = editorAssociations as NewEditorAssociationSetting['*.ipynb'];

        // Update the settings
        if (shouldEnableNativeNotebooksAssociation && !isJupyterNotebook(currentAssociation)) {
            updatedSettings['*.ipynb'] = JupyterNotebookView;
            await settings.update('editorAssociations', updatedSettings, ConfigurationTarget.Global);
        }

        // Revert the settings.
        if (!shouldEnableNativeNotebooksAssociation && isJupyterNotebook(currentAssociation)) {
            delete updatedSettings['*.ipynb'];
            await settings.update('editorAssociations', updatedSettings, ConfigurationTarget.Global);
        }
    }
    private async disableNotebooks() {
        await this.enableDisableEditorAssociation(false);
    }
}

export type NewEditorAssociationSetting = { [glob: string]: string };
export type OldEditorAssociationSetting = {
    viewType: string;
    filenamePattern: string;
}[];

export function ensureUpdatedEditorAssociationSettingFormat(editorAssociations: unknown) {
    // editorAssociations used to be an array. If we see an array here we should
    // first update everything to the new format.
    if (Array.isArray(editorAssociations)) {
        const oldSettings = editorAssociations as OldEditorAssociationSetting;
        const newSetting: NewEditorAssociationSetting = {};
        oldSettings.forEach((setting) => {
            newSetting[setting.filenamePattern] = setting.viewType;
        });
        editorAssociations = newSetting;
    }
    return editorAssociations;
}
