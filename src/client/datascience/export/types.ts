import { CancellationToken, Uri } from 'vscode';
import { PythonEnvironment } from '../../pythonEnvironments/info';

export enum ExportFormat {
    pdf = 'pdf',
    html = 'html',
    python = 'python',
    ipynb = 'ipynb'
}

export const IExportManager = Symbol('IExportManager');
export interface IExportManager {
    export(format: ExportFormat, contents: string, source: Uri, defaultFileName?: string): Promise<undefined>;
}

export const IExport = Symbol('IExport');
export interface IExport {
    export(source: Uri, target: Uri, interpreter: PythonEnvironment, token: CancellationToken): Promise<void>;
}

export const IExportDialog = Symbol('IExportDialog');
export interface IExportDialog {
    showDialog(format: ExportFormat, source: Uri | undefined, defaultFileName?: string): Promise<Uri | undefined>;
}
