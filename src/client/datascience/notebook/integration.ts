// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { ConfigurationTarget } from 'vscode';
import { NotebookContentProvider as VSCNotebookContentProvider } from '../../../../types/vscode-proposed';
import { IExtensionSingleActivationService } from '../../activation/types';
import {
    IApplicationEnvironment,
    IApplicationShell,
    ICommandManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../common/application/types';
import { Experiments } from '../../common/experiments/groups';
import { traceError } from '../../common/logger';
import { IDisposableRegistry, IExperimentService, IExtensionContext } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { JupyterNotebookView } from './constants';
import { isJupyterNotebook } from './helpers/helpers';
import { VSCodeKernelPickerProvider } from './kernelProvider';
import { INotebookContentProvider, INotebookKernelProvider } from './types';

const EditorAssociationUpdatedKey = 'EditorAssociationUpdatedToUseNotebooks';

/**
 * This class basically registers the necessary providers and the like with VSC.
 * I.e. this is where we integrate our stuff with VS Code via their extension endpoints.
 */

@injectable()
export class NotebookIntegration implements IExtensionSingleActivationService {
    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IExperimentService) private readonly experimentService: IExperimentService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookContentProvider) private readonly notebookContentProvider: VSCNotebookContentProvider,
        @inject(INotebookKernelProvider) private readonly kernelProvider: VSCodeKernelPickerProvider,
        @inject(IApplicationEnvironment) private readonly env: IApplicationEnvironment,
        @inject(IApplicationShell) private readonly shell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext,
        @inject(ICommandManager) private readonly commandManager: ICommandManager
    ) {}
    public async activate(): Promise<void> {
        // This condition is temporary.
        // If user belongs to the experiment, then make the necessary changes to package.json.
        // Once the API is final, we won't need to modify the package.json.
        if (await this.experimentService.inExperiment(Experiments.NativeNotebook)) {
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
        if (this.env.channel === 'insiders') {
            try {
                this.disposables.push(
                    this.vscNotebook.registerNotebookContentProvider(
                        JupyterNotebookView,
                        this.notebookContentProvider,
                        {
                            transientOutputs: false,
                            transientMetadata: {
                                breakpointMargin: true,
                                editable: true,
                                hasExecutionOrder: true,
                                inputCollapsed: true,
                                lastRunDuration: true,
                                outputCollapsed: true,
                                runStartTime: true,
                                runnable: true,
                                executionOrder: false,
                                custom: false,
                                runState: false,
                                statusMessage: false
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
            } catch (ex) {
                // If something goes wrong, and we're not in Insiders & not using the NativeEditor experiment, then swallow errors.
                traceError('Failed to register VS Code Notebook API', ex);
                if (await this.experimentService.inExperiment(Experiments.NativeNotebook)) {
                    throw ex;
                }
            }
        }
    }
    private async enableNotebooks() {
        if (this.env.channel === 'stable') {
            this.shell.showErrorMessage(DataScience.previewNotebookOnlySupportedInVSCInsiders()).then(noop, noop);
            return;
        }

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
            await Promise.all([
                this.extensionContext.globalState.update(EditorAssociationUpdatedKey, true),
                settings.update('editorAssociations', editorAssociations, ConfigurationTarget.Global)
            ]);
        }

        // Revert the settings.
        if (
            !enable &&
            this.extensionContext.globalState.get<boolean>(EditorAssociationUpdatedKey, false) &&
            Array.isArray(editorAssociations) &&
            editorAssociations.find((item) => isJupyterNotebook(item.viewType))
        ) {
            const updatedSettings = editorAssociations.filter((item) => !isJupyterNotebook(item.viewType));
            await Promise.all([
                this.extensionContext.globalState.update(EditorAssociationUpdatedKey, false),
                settings.update('editorAssociations', updatedSettings, ConfigurationTarget.Global)
            ]);
        }
    }
    private async disableNotebooks() {
        if (this.env.channel === 'stable') {
            return;
        }
        // If we never modified the settings, then nothing to do.
        if (!this.extensionContext.globalState.get<boolean>(EditorAssociationUpdatedKey, false)) {
            return;
        }
        await this.enableDisableEditorAssociation(false);
    }
}
