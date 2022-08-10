// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

'use strict';
import * as path from '../../vscode-path/path';
import { Uri, Range } from 'vscode';
import { IWorkspaceService, IDocumentManager } from '../application/types';
import { AbstractSystemVariables } from './systemVariables';

/**
 * System variables for node.js. Node specific is necessary because of using the current process environment.
 */
export class SystemVariables extends AbstractSystemVariables {
    private _workspaceFolder: string;
    private _workspaceFolderName: string;
    private _filePath: string | undefined;
    private _lineNumber: number | undefined;
    private _selectedText: string | undefined;
    private _execPath: string;

    constructor(
        file: Uri | undefined,
        rootFolder: Uri | undefined,
        workspace?: IWorkspaceService,
        documentManager?: IDocumentManager
    ) {
        super();
        const workspaceFolder = workspace && file ? workspace.getWorkspaceFolder(file) : undefined;
        this._workspaceFolder = workspaceFolder ? workspaceFolder.uri.fsPath : rootFolder?.fsPath || __dirname;
        this._workspaceFolderName = path.basename(this._workspaceFolder);
        this._filePath = file ? file.fsPath : undefined;
        if (documentManager && documentManager.activeTextEditor) {
            this._lineNumber = documentManager.activeTextEditor.selection.anchor.line + 1;
            this._selectedText = documentManager.activeTextEditor.document.getText(
                new Range(
                    documentManager.activeTextEditor.selection.start,
                    documentManager.activeTextEditor.selection.end
                )
            );
        }
        this._execPath = process.execPath;
        Object.keys(process.env).forEach((key) => {
            (this as any as Record<string, string | undefined>)[`env:${key}`] = (
                this as any as Record<string, string | undefined>
            )[`env.${key}`] = process.env[key];
        });
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

    public get workspaceRootFolderName(): string {
        return this._workspaceFolderName;
    }

    public get workspaceFolderBasename(): string {
        return this._workspaceFolderName;
    }

    public get file(): string | undefined {
        return this._filePath;
    }

    public get relativeFile(): string | undefined {
        return this.file ? path.relative(this._workspaceFolder, this.file) : undefined;
    }

    public get relativeFileDirname(): string | undefined {
        return this.relativeFile ? path.dirname(this.relativeFile) : undefined;
    }

    public get fileBasename(): string | undefined {
        return this.file ? path.basename(this.file) : undefined;
    }

    public get fileBasenameNoExtension(): string | undefined {
        return this.file ? path.parse(this.file).name : undefined;
    }

    public get fileDirname(): string | undefined {
        return this.file ? path.dirname(this.file) : undefined;
    }

    public get fileExtname(): string | undefined {
        return this.file ? path.extname(this.file) : undefined;
    }

    public get lineNumber(): number | undefined {
        return this._lineNumber;
    }

    public get selectedText(): string | undefined {
        return this._selectedText;
    }

    public get execPath(): string {
        return this._execPath;
    }
}
