// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import {
    ConfigurationTarget,
    languages,
    NotebookContentProvider as VSCNotebookContentProvider,
    NotebookCellStatusBarItemProvider as VSCNotebookCellStatusBarItemProvider
} from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import {
    IApplicationEnvironment,
    ICommandManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../common/application/types';
import { NotebookCellScheme, PYTHON_LANGUAGE, UseVSCodeNotebookEditorApi } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IDisposableRegistry } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { JupyterNotebookView } from './constants';
import { isJupyterNotebook, NotebookCellStateTracker } from './helpers/helpers';
import { NotebookCompletionProvider } from './intellisense/completionProvider';
import { VSCodeKernelPickerProvider } from './kernelProvider';
import { INotebookContentProvider, INotebookKernelProvider, INotebookStatusBarProvider } from './types';

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
        @inject(INotebookKernelProvider) private readonly kernelProvider: VSCodeKernelPickerProvider,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(INotebookStatusBarProvider) private readonly statusBarProvider: VSCNotebookCellStatusBarItemProvider,
        @inject(NotebookCompletionProvider) private readonly completionProvider: NotebookCompletionProvider
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
                this.disposables.push(
                    this.vscNotebook.registerNotebookKernelProvider(
                        { filenamePattern: '**/*.ipynb', viewType: JupyterNotebookView },
                        this.kernelProvider
                    )
                );
                this.disposables.push(
                    this.vscNotebook.registerNotebookCellStatusBarItemProvider(
                        { pattern: '**/*.ipynb', viewType: JupyterNotebookView },
                        this.statusBarProvider
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
    }
    private async enableDisableEditorAssociation(enable: boolean) {
        // This code is temporary.
        const settings = this.workspace.getConfiguration('workbench', undefined);
        const editorAssociations = settings.get('editorAssociations') as {
            viewType: string;
            filenamePattern: string;
        }[];

        // Update the settings.
        if (
            enable &&
            (!Array.isArray(editorAssociations) ||
                editorAssociations.length === 0 ||
                !editorAssociations.find((item) => isJupyterNotebook(item.viewType)))
        ) {
            editorAssociations.push({
                viewType: 'jupyter-notebook',
                filenamePattern: '*.ipynb'
            });
            await settings.update('editorAssociations', editorAssociations, ConfigurationTarget.Global);
        }

        // Revert the settings.
        if (
            !enable &&
            Array.isArray(editorAssociations) &&
            editorAssociations.find((item) => isJupyterNotebook(item.viewType))
        ) {
            const updatedSettings = editorAssociations.filter((item) => !isJupyterNotebook(item.viewType));
            await settings.update('editorAssociations', updatedSettings, ConfigurationTarget.Global);
        }
    }
    private async disableNotebooks() {
        await this.enableDisableEditorAssociation(false);
    }
}
