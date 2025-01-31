// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, WorkspaceFolder } from 'vscode';
import * as path from '../../vscode-path/path';
import * as uriPath from '../../vscode-path/resources';
import { getOSType, OSType } from '../utils/platform';
import { isWeb } from '../utils/misc';

function getHomeDir() {
    if (isWeb()) {
        return undefined;
    }
    // eslint-disable-next-line local-rules/node-imports
    return Uri.file(require('os').homedir()); // This is the only thing requiring a node version
}
export function getFilePath(file: Uri | undefined) {
    const isWindows = getOSType() === OSType.Windows;
    if (file) {
        const fsPath = uriPath.originalFSPath(file);

        // Remove separator on the front if not a network drive.
        // Example, if you create a URI with Uri.file('hello world'), the fsPath will come out as '\Hello World' on windows. We don't want that
        // However if you create a URI from a network drive, like '\\mydrive\foo\bar\python.exe', we want to keep the \\ on the front.
        if (fsPath && fsPath.startsWith(path.sep) && fsPath.length > 1 && fsPath[1] !== path.sep && isWindows) {
            return fsPath.slice(1);
        }
        return fsPath || '';
    }
    return '';
}

export function getDisplayPath(
    filename: Uri | string | undefined,
    workspaceFolders: readonly WorkspaceFolder[] | WorkspaceFolder[] = [],
    homePathUri?: Uri
) {
    homePathUri = homePathUri || getHomeDir();
    let fileUri: Uri | undefined = undefined;
    if (typeof filename && typeof filename === 'string') {
        fileUri = Uri.file(filename);
    }
    if (typeof filename && typeof filename !== 'string') {
        fileUri = filename;
    }
    const relativeToHome = getDisplayPathImpl(fileUri, undefined, homePathUri);
    const workspaceFolderThatOwnsTheFile = workspaceFolders.find(
        (w) => fileUri && uriPath.isEqualOrParent(fileUri, w.uri, true)
    );
    // If there is more than one workspace folder, then we need to display the workspace folder name.
    // This is because we can have two files with the same name in different workspace folders.
    // E.g. .venv/bin/python can exist in multiple workspace folders.
    if (workspaceFolders.length > 1 && workspaceFolderThatOwnsTheFile) {
        return `${workspaceFolderThatOwnsTheFile.name}${path.sep}${getDisplayPathImpl(
            fileUri,
            workspaceFolderThatOwnsTheFile.uri,
            homePathUri
        )}`;
    }

    const relativeToWorkspaceFolders = workspaceFolderThatOwnsTheFile
        ? [getDisplayPathImpl(fileUri, workspaceFolderThatOwnsTheFile.uri, homePathUri)]
        : [];
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
    const isWindows = getOSType() === OSType.Windows;
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

    return getFilePath(file);
}
