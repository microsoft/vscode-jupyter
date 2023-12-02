// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Uri, Range, workspace, window } from 'vscode';
import { AbstractSystemVariables } from './systemVariables';

/**
 * System variables for web extension. Web specific is necessary because of lacking of the current process environment.
 */
export class SystemVariables extends AbstractSystemVariables {
    private _workspaceFolder: string;
    private _filePath: string | undefined;
    private _lineNumber: number | undefined;
    private _selectedText: string | undefined;

    constructor(file: Uri | undefined, rootFolder: string | undefined) {
        super();
        const workspaceFolder = file ? workspace.getWorkspaceFolder(file) : undefined;
        this._workspaceFolder = workspaceFolder ? workspaceFolder.uri.path : rootFolder || '';
        this._filePath = file ? file.path : undefined;
        if (window.activeTextEditor) {
            this._lineNumber = window.activeTextEditor.selection.anchor.line + 1;
            this._selectedText = window.activeTextEditor.document.getText(
                new Range(window.activeTextEditor.selection.start, window.activeTextEditor.selection.end)
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
