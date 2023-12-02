// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';

export enum ExportFormat {
    pdf = 'pdf',
    html = 'html',
    python = 'python',
    ipynb = 'ipynb'
}

export const IFileConverter = Symbol('IFileConverter');
export interface IFileConverter {
    export(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        defaultFileName?: string,
        candidateInterpreter?: PythonEnvironment
    ): Promise<undefined>;
    importIpynb(source: Uri): Promise<void>;
}

export const IExportBase = Symbol('IExportBase');
export interface IExportBase {
    executeCommand(
        sourceDocument: NotebookDocument,
        target: Uri,
        format: ExportFormat,
        interpreter: PythonEnvironment,
        token: CancellationToken
    ): Promise<void>;
}

export const IExport = Symbol('IExport');
export interface IExport {
    export(sourceDocument: NotebookDocument, target: Uri, token: CancellationToken): Promise<void>;
}

export const IExportUtil = Symbol('IExportUtil');
export interface IExportUtil {
    getContent(document: NotebookDocument): Promise<string>;
    getTargetFile(format: ExportFormat, source: Uri, defaultFileName?: string | undefined): Promise<Uri | undefined>;
}
