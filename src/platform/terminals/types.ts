// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEditor, Uri } from 'vscode';

export const ICodeExecutionHelper = Symbol('ICodeExecutionHelper');

export interface ICodeExecutionHelper {
    normalizeLines(code: string): Promise<string>;
    getFileToExecute(): Promise<Uri | undefined>;
    saveFileIfDirty(file: Uri): Promise<void>;
    getSelectedTextToExecute(textEditor: TextEditor): string | undefined;
}
