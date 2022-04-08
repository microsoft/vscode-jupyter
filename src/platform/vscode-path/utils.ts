// Miscellaneous functions from other spots in VS code

import { Uri, Uri as URI } from 'vscode';
import { CharCode } from './charCode';
import { isWindows } from './platform';

/**
 * Compute `fsPath` for the given uri
 */
export function uriToFsPath(uri: URI, keepDriveLetterCasing: boolean): string {
    let value: string;
    if (uri.authority && uri.path.length > 1 && uri.scheme === 'file') {
        // unc path: file://shares/c$/far/boo
        value = `//${uri.authority}${uri.path}`;
    } else if (
        uri.path.charCodeAt(0) === CharCode.Slash &&
        ((uri.path.charCodeAt(1) >= CharCode.A && uri.path.charCodeAt(1) <= CharCode.Z) ||
            (uri.path.charCodeAt(1) >= CharCode.a && uri.path.charCodeAt(1) <= CharCode.z)) &&
        uri.path.charCodeAt(2) === CharCode.Colon
    ) {
        if (!keepDriveLetterCasing) {
            // windows drive letter: file:///c:/far/boo
            value = uri.path[1].toLowerCase() + uri.path.substr(2);
        } else {
            value = uri.path.substr(1);
        }
    } else {
        // other path
        value = uri.path;
    }
    if (isWindows) {
        value = value.replace(/\//g, '\\');
    }
    return value;
}

export function fsPathToUri(path: string | undefined) {
    return path ? Uri.file(path) : undefined;
}

export namespace Schemas {
    /**
     * A schema that is used for models that exist in memory
     * only and that have no correspondence on a server or such.
     */
    export const inMemory = 'inmemory';

    /**
     * A schema that is used for setting files
     */
    export const vscode = 'vscode';

    /**
     * A schema that is used for internal private files
     */
    export const internal = 'private';

    /**
     * A walk-through document.
     */
    export const walkThrough = 'walkThrough';

    /**
     * An embedded code snippet.
     */
    export const walkThroughSnippet = 'walkThroughSnippet';

    export const http = 'http';

    export const https = 'https';

    export const file = 'file';

    export const mailto = 'mailto';

    export const untitled = 'untitled';

    export const data = 'data';

    export const command = 'command';

    export const vscodeRemote = 'vscode-remote';

    export const vscodeRemoteResource = 'vscode-remote-resource';

    export const vscodeUserData = 'vscode-userdata';

    export const vscodeCustomEditor = 'vscode-custom-editor';

    export const vscodeNotebook = 'vscode-notebook';

    export const vscodeNotebookCell = 'vscode-notebook-cell';

    export const vscodeNotebookCellMetadata = 'vscode-notebook-cell-metadata';
    export const vscodeNotebookCellOutput = 'vscode-notebook-cell-output';
    export const vscodeInteractive = 'vscode-interactive';
    export const vscodeInteractiveInput = 'vscode-interactive-input';

    export const vscodeSettings = 'vscode-settings';

    export const vscodeWorkspaceTrust = 'vscode-workspace-trust';

    export const vscodeTerminal = 'vscode-terminal';

    /**
     * Scheme used internally for webviews that aren't linked to a resource (i.e. not custom editors)
     */
    export const webviewPanel = 'webview-panel';

    /**
     * Scheme used for loading the wrapper html and script in webviews.
     */
    export const vscodeWebview = 'vscode-webview';

    /**
     * Scheme used for extension pages
     */
    export const extension = 'extension';

    /**
     * Scheme used as a replacement of `file` scheme to load
     * files with our custom protocol handler (desktop only).
     */
    export const vscodeFileResource = 'vscode-file';

    /**
     * Scheme used for temporary resources
     */
    export const tmp = 'tmp';

    /**
     * Scheme used vs live share
     */
    export const vsls = 'vsls';
}
