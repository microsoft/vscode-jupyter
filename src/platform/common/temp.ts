// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileType, Uri, workspace } from 'vscode';
import type { IExtensionContext } from './types';
import { isWeb, noop } from './utils/misc';
import type { IFileSystem } from './platform/types';
import { logger } from '../logging';

export const TEMP_DIR_PREFIX = 'version';

export function getCurrentTempDirName(context: IExtensionContext): string {
    return `${TEMP_DIR_PREFIX}-${context.extension.packageJSON.version || 'version'}`;
}

export async function getExtensionTempDir(context: IExtensionContext, fs?: IFileSystem): Promise<Uri> {
    if (isWeb()) {
        return Uri.joinPath(context.globalStorageUri, getCurrentTempDirName(context));
    } else {
        // Ensure we use the file scheme when dealing with the desktop version of VS Code.
        // eslint-disable-next-line local-rules/dont-use-fspath
        let dir = Uri.joinPath(Uri.file(context.globalStorageUri.fsPath), getCurrentTempDirName(context));
        if (fs) {
            // Verify we can create this directory, this ensures the fact taht the user has permissions in this dir.
            try {
                await fs.createDirectory(dir);
            } catch (ex) {
                // eslint-disable-next-line local-rules/dont-use-fspath
                logger.warn(`Failed to create temp directory (${dir.fsPath}), falling back to extension dir`, ex);
                dir = Uri.joinPath(context.extensionUri, 'temp');
                await fs.createDirectory(dir);
            }
        }
        return dir;
    }
}

export async function deleteTempDirs(context: IExtensionContext) {
    try {
        const dirs = await workspace.fs.readDirectory(context.globalStorageUri);
        await Promise.all(
            dirs
                .filter(([name, type]) => name.startsWith(TEMP_DIR_PREFIX) && type === FileType.Directory)
                .map(([dir]) => workspace.fs.delete(Uri.joinPath(context.globalStorageUri, dir), { recursive: true }))
        ).catch(noop);
    } catch {
        //
    }
}
