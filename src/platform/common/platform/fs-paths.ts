import { Uri, WorkspaceFolder } from 'vscode';
import * as path from '../../vscode-path/path';
import { isWindows } from '../../vscode-path/platform';
import * as uriPath from '../../vscode-path/resources';
import { uriToFsPath } from '../../vscode-path/utils';

export function getDisplayPath(
    filename: Uri | undefined,
    workspaceFolders: readonly WorkspaceFolder[] | WorkspaceFolder[] = [],
    homePath: Uri | undefined = undefined
) {
    const relativeToHome = getDisplayPathImpl(filename, undefined, homePath);
    const relativeToWorkspaceFolders = workspaceFolders.map((folder) =>
        getDisplayPathImpl(filename, folder.uri, homePath)
    );
    // Pick the shortest path for display purposes.
    // As those are most likely relative to some workspace folder.
    let bestDisplayPath = relativeToHome;
    [relativeToHome, ...relativeToWorkspaceFolders].forEach((relativePath) => {
        if (relativePath.length < bestDisplayPath.length) {
            bestDisplayPath = relativePath;
        }
    });

    return bestDisplayPath;
}

function getDisplayPathImpl(file: Uri | undefined, cwd: Uri | undefined, homePath: Uri | undefined): string {
    if (file && cwd && uriPath.isEqualOrParent(file, cwd, true)) {
        const relativePath = uriPath.relativePath(cwd, file);
        if (relativePath) {
            // On windows relative path will still use forwardslash because uriPath.relativePath is a URI path
            return isWindows ? relativePath.replace(/\//g, '\\') : relativePath;
        }
    }

    if (file && homePath && uriPath.isEqualOrParent(file, homePath, true)) {
        let relativePath = uriPath.relativePath(homePath, file);
        if (relativePath) {
            // On windows relative path will still use forwardslash because uriPath.relativePath is a URI path
            relativePath = isWindows ? relativePath.replace(/\//g, '\\') : relativePath;
            return `~${path.sep}${relativePath}`;
        }
    }

    if (file) {
        const fsPath = uriToFsPath(file, true);

        // Remove separator on the front
        if (fsPath.startsWith(path.sep)) {
            return fsPath.slice(1);
        }
        return fsPath;
    }

    return '';
}
