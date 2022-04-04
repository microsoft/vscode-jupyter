import { Uri, WorkspaceFolder } from 'vscode';
import * as path from 'path-browserify';

export function getDisplayPath(
    filename?: string | Uri,
    workspaceFolders: readonly WorkspaceFolder[] | WorkspaceFolder[] = []
) {
    const relativeToHome = getDisplayPathImpl(filename);
    const relativeToWorkspaceFolders = workspaceFolders.map((folder) => getDisplayPathImpl(filename, folder.uri.path));
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

function getDisplayPathImpl(filename?: string | Uri, cwd?: string): string {
    let file = '';
    if (typeof filename === 'string') {
        file = filename;
    } else if (!filename) {
        file = '';
    } else if (filename.scheme === 'file') {
        file = filename.path;
    } else {
        file = filename.toString();
    }
    if (!file) {
        return '';
    } else if (cwd && file.startsWith(cwd)) {
        const relativePath = `.${path.sep}${path.relative(cwd, file)}`;
        // On CI the relative path might not work as expected as when testing we might have windows paths
        // and the code is running on a unix machine.
        return relativePath === file || relativePath.includes(cwd)
            ? `.${path.sep}${file.substring(file.indexOf(cwd) + cwd.length)}`
            : relativePath;
    } else {
        return file;
    }
}
