import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';

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

export const INbConvertExport = Symbol('INbConvertExport');
export interface INbConvertExport {
    export(
        sourceDocument: NotebookDocument,
        interpreter: PythonEnvironment | undefined,
        defaultFileName: string | undefined,
        token: CancellationToken
    ): Promise<Uri | undefined>;
}

export const IExportBase = Symbol('IExportBase');
export interface IExportBase {
    executeCommand(
        sourceDocument: NotebookDocument,
        defaultFileName: string | undefined,
        format: ExportFormat,
        interpreter: PythonEnvironment,
        token: CancellationToken
    ): Promise<Uri | undefined>;
}

export const IExport = Symbol('IExport');
export interface IExport {
    export(
        sourceDocument: NotebookDocument,
        defaultFileName: string | undefined,
        token: CancellationToken
    ): Promise<Uri | undefined>;
}

export const IExportDialog = Symbol('IExportDialog');
export interface IExportDialog {
    showDialog(format: ExportFormat, source: Uri | undefined, defaultFileName?: string): Promise<Uri | undefined>;
}
