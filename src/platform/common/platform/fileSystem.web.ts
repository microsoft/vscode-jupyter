import * as vscode from 'vscode';
import { FileType } from './types.node';
import { traceError } from '../../logging';
import { isFileNotFoundError } from './errors';

/**
 * File system abstraction which wraps the VS Code API.
 */
export async function getFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
    const files = await vscode.workspace.fs.readDirectory(dir);
    return files.filter((f) => f[1] === FileType.File).map((f) => vscode.Uri.file(f[0]));
}

export async function localPathExists(
    // the "file" to look for
    filename: string,
    // the file type to expect; if not provided then any file type
    // matches; otherwise a mismatch results in a "false" value
    fileType?: FileType
): Promise<boolean> {
    let stat: vscode.FileStat;
    try {
        // Note that we are using stat() rather than lstat().  This
        // means that any symlinks are getting resolved.
        const uri = vscode.Uri.file(filename);
        stat = await vscode.workspace.fs.stat(uri);
    } catch (err) {
        if (isFileNotFoundError(err)) {
            return false;
        }
        traceError(`stat() failed for "${filename}"`, err);
        return false;
    }

    if (fileType === undefined) {
        return true;
    }
    if (fileType === FileType.Unknown) {
        // FileType.Unknown == 0, hence do not use bitwise operations.
        return stat.type === FileType.Unknown;
    }
    return (stat.type & fileType) === fileType;
}

export async function localFileExists(filename: string): Promise<boolean> {
    return localPathExists(filename, FileType.File);
}
