// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { OurNotebookProvider, Telemetry } from '../../datascience/constants';
import {
    NewEditorAssociationSetting,
    ensureUpdatedEditorAssociationSettingFormat
} from '../../datascience/notebook/integration';
import { sendTelemetryEvent } from '../../telemetry';

import { UseCustomEditorApi } from '../constants';
import { CustomEditorProvider, ICommandManager, ICustomEditorService, IWorkspaceService } from './types';

export const ViewType = 'jupyter.notebook.ipynb';

@injectable()
export class CustomEditorService implements ICustomEditorService, IExtensionSingleActivationService {
    constructor(
        @inject(UseCustomEditorApi) private readonly useCustomEditorApi: boolean,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(OurNotebookProvider) private readonly editorProvider: CustomEditorProvider,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {}

    public async openEditor(file: vscode.Uri, viewType: string): Promise<void> {
        // This is necessary to abstract the open for functional tests.
        if (this.useCustomEditorApi) {
            await this.commandManager.executeCommand('vscode.openWith', file, viewType);
        }
    }

    public async activate() {
        let updateType: 'added' | 'removed' | undefined;
        try {
            const settings = this.workspace.getConfiguration('workbench', undefined);
            const editorAssociations = settings.get('editorAssociations'); // At this point we don't know if this is the old or new format
            const updatedSettings = ensureUpdatedEditorAssociationSettingFormat(
                editorAssociations
            ) as NewEditorAssociationSetting;

            // Update the settings.
            if (this.useCustomEditorApi && updatedSettings['*.ipynb'] !== ViewType) {
                updatedSettings['*.ipynb'] = ViewType;
                updateType = 'added';
                await settings.update('editorAssociations', updatedSettings, vscode.ConfigurationTarget.Global);
                sendTelemetryEvent(Telemetry.UpdateCustomEditorAssociation, undefined, { type: updateType });
            }

            // Revert the settings.
            if (!this.useCustomEditorApi && updatedSettings['*.ipynb'] === ViewType) {
                updatedSettings['*ipynb'] = undefined;
                updateType = 'removed';
                await settings.update('editorAssociations', updatedSettings, vscode.ConfigurationTarget.Global);
                sendTelemetryEvent(Telemetry.UpdateCustomEditorAssociation, undefined, { type: updateType });
            }
        } catch (ex) {
            sendTelemetryEvent(Telemetry.UpdateCustomEditorAssociation, undefined, { type: updateType! }, ex, true);
        }

        // Always register our custom editor provider even if not in the experiment. This allows us
        // to handle custom editor requests even when not the default
        vscode.window.registerCustomEditorProvider('jupyter.notebook.ipynb', this.editorProvider, {
            webviewOptions: {
                enableFindWidget: true,
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        });
    }
}
