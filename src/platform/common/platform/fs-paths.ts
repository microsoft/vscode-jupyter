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
    // Common file separator is unix based '/'. Handle mixing of paths
    let cwdReplaced = cwd ? cwd.replace(/\\/g, '/') : undefined;
    if (cwdReplaced?.includes(':') && cwdReplaced.startsWith('/')) {
        cwdReplaced = cwdReplaced.slice(1);
    }
    let file = '';
    if (typeof filename === 'string') {
        file = filename.replace(/\\/g, '/');
    } else if (!filename) {
        file = '';
    } else if (filename.scheme === 'file') {
        file = filename.path;
    } else {
        file = filename.toString().replace(/\\/g, '/');
    }
    if (!file) {
        return '';
    } else if (cwdReplaced && file.startsWith(cwdReplaced)) {
        const relativePath = `.${path.sep}${path.relative(cwdReplaced, file)}`;
        // On CI the relative path might not work as expected as when testing we might have windows paths
        // and the code is running on a unix machine.
        return relativePath === file || relativePath.includes(cwdReplaced)
            ? `.${path.sep}${file.substring(file.indexOf(cwdReplaced) + cwdReplaced.length)}`
            : relativePath;
    } else {
        return file;
    }
}
