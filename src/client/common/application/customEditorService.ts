// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { OurNotebookProvider } from '../../datascience/constants';

import { UseCustomEditorApi } from '../constants';
import { CustomEditorProvider, ICommandManager, ICustomEditorService } from './types';

export const ViewType = 'jupyter.notebook.ipynb';

@injectable()
export class CustomEditorService implements ICustomEditorService, IExtensionSingleActivationService {
    constructor(
        @inject(UseCustomEditorApi) private readonly useCustomEditorApi: boolean,
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
        // Always register our custom editor provider. This allows us
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
