// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { Telemetry } from '../../datascience/constants';
import { sendTelemetryEvent } from '../../telemetry';

import { UseCustomEditorApi } from '../constants';
import { InvalidCustomEditor } from './invalidCustomEditor';
import { CustomEditorProvider, ICommandManager, ICustomEditorService, IWorkspaceService } from './types';

export const ViewType = 'jupyter.notebook.ipynb';

@injectable()
export class CustomEditorService implements ICustomEditorService, IExtensionSingleActivationService {
    constructor(
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(UseCustomEditorApi) private readonly useCustomEditorApi: boolean,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}

    public registerCustomEditorProvider(
        viewType: string,
        provider: CustomEditorProvider,
        options?: {
            readonly webviewOptions?: vscode.WebviewPanelOptions;
            readonly supportsMultipleEditorsPerDocument?: boolean;
        }
    ): vscode.Disposable {
        if (this.useCustomEditorApi) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (vscode.window as any).registerCustomEditorProvider(viewType, provider, options);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (vscode.window as any).registerCustomEditorProvider(viewType, new InvalidCustomEditor(), options);
        }
    }

    public async openEditor(file: vscode.Uri, viewType: string): Promise<void> {
        if (this.useCustomEditorApi) {
            await this.commandManager.executeCommand('vscode.openWith', file, viewType);
        }
    }

    public async activate() {
        let updateType: 'added' | 'removed' | undefined;
        try {
            // This code is temporary.
            const settings = this.workspace.getConfiguration('workbench', undefined);
            const editorAssociations = settings.get('editorAssociations') as {
                viewType: string;
                filenamePattern: string;
            }[];

            // Update the settings.
            if (
                this.useCustomEditorApi &&
                (editorAssociations.length === 0 || !editorAssociations.find((item) => item.viewType === ViewType))
            ) {
                editorAssociations.push({
                    viewType: ViewType,
                    filenamePattern: '*.ipynb'
                });
                updateType = 'added';
                await settings.update('editorAssociations', editorAssociations, vscode.ConfigurationTarget.Global);
                sendTelemetryEvent(Telemetry.UpdateCustomEditorAssociation, undefined, { type: 'added' });
            }

            // Revert the settings.
            if (
                !this.useCustomEditorApi &&
                Array.isArray(editorAssociations) &&
                editorAssociations.find((item) => item.viewType === ViewType)
            ) {
                const updatedSettings = editorAssociations.filter((item) => item.viewType !== ViewType);
                updateType = 'removed';
                await settings.update('editorAssociations', updatedSettings, vscode.ConfigurationTarget.Global);
                sendTelemetryEvent(Telemetry.UpdateCustomEditorAssociation, undefined, { type: 'removed' });
            }
        } catch (ex) {
            sendTelemetryEvent(Telemetry.UpdateCustomEditorAssociation, undefined, { type: updateType! }, ex, true);
        }
    }
}
