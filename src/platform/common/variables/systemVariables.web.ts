// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
import { Uri, Range } from 'vscode';
import { IWorkspaceService, IDocumentManager } from '../application/types';
import { AbstractSystemVariables } from './systemVariables';

/**
 * System variables for web extension. Web specific is necessary because of lacking of the current process environment.
 */
export class SystemVariables extends AbstractSystemVariables {
    private _workspaceFolder: string;
    private _filePath: string | undefined;
    private _lineNumber: number | undefined;
    private _selectedText: string | undefined;

    constructor(
        file: Uri | undefined,
        rootFolder: string | undefined,
        workspace?: IWorkspaceService,
        documentManager?: IDocumentManager
    ) {
        super();
        const workspaceFolder = workspace && file ? workspace.getWorkspaceFolder(file) : undefined;
        this._workspaceFolder = workspaceFolder ? workspaceFolder.uri.path : rootFolder || '';
        this._filePath = file ? file.path : undefined;
        if (documentManager && documentManager.activeTextEditor) {
            this._lineNumber = documentManager.activeTextEditor.selection.anchor.line + 1;
            this._selectedText = documentManager.activeTextEditor.document.getText(
                new Range(
                    documentManager.activeTextEditor.selection.start,
                    documentManager.activeTextEditor.selection.end
                )
            );
        }
    }

    public get cwd(): string {
        return this.workspaceFolder;
    }

    public get workspaceRoot(): string {
        return this._workspaceFolder;
    }

    public get workspaceFolder(): string {
        return this._workspaceFolder;
    }

    public get file(): string | undefined {
        return this._filePath;
    }

    public get lineNumber(): number | undefined {
        return this._lineNumber;
    }

    public get selectedText(): string | undefined {
        return this._selectedText;
    }
}
