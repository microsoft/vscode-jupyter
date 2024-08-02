// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileType, Uri, workspace } from 'vscode';
import type { IExtensionContext } from './types';
import { noop } from './utils/misc';

export const TEMP_DIR_PREFIX = 'version';

export function getCurrentTempDirName(context: IExtensionContext): string {
    return `${TEMP_DIR_PREFIX}-${context.extension.packageJSON.version || 'version'}`;
}

export function getExtensionTempDir(context: IExtensionContext): Uri {
    return Uri.joinPath(context.globalStorageUri, getCurrentTempDirName(context));
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
