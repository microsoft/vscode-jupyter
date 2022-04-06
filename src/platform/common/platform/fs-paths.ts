import { Uri, WorkspaceFolder } from 'vscode';
import * as path from '../../vscode-path/path';
import * as uriPath from '../../vscode-path/resources';

export function getDisplayPath(
    filename: Uri | undefined,
    workspaceFolders: readonly WorkspaceFolder[] | WorkspaceFolder[] = [],
    homePath: Uri | undefined
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
        const relativePath = uriPath.relativePath(file, cwd);
        if (relativePath) {
            return relativePath;
        }
    }

    if (file && homePath && uriPath.isEqualOrParent(file, homePath, true)) {
        const relativePath = uriPath.relativePath(file, homePath);
        if (relativePath) {
            return `~${path.sep}${relativePath}`;
        }
    }

    if (file) {
        // eslint-disable-next-line local-rules/dont-use-fspath
        return file.fsPath || file.path;
    }

    return '';
}
