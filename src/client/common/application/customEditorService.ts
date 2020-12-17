// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';

import { UseCustomEditorApi } from '../constants';
import { traceError } from '../logger';
import { InvalidCustomEditor } from './invalidCustomEditor';
import { CustomEditorProvider, ICommandManager, ICustomEditorService, IWorkspaceService } from './types';

export const ViewType = 'jupyter.notebook.ipynb';

@injectable()
export class CustomEditorService implements ICustomEditorService {
    constructor(
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(UseCustomEditorApi) private readonly useCustomEditorApi: boolean,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {
        this.enableCustomEditors().catch((e) => traceError(`Error setting up custom editors: `, e));
    }

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async enableCustomEditors() {
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
            await settings.update('editorAssociations', editorAssociations, vscode.ConfigurationTarget.Global);
        }

        // Revert the settings.
        if (
            !this.useCustomEditorApi &&
            Array.isArray(editorAssociations) &&
            editorAssociations.find((item) => item.viewType === ViewType)
        ) {
            const updatedSettings = editorAssociations.filter((item) => item.viewType !== ViewType);
            await settings.update('editorAssociations', updatedSettings, vscode.ConfigurationTarget.Global);
        }
    }
}
