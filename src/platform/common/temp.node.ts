// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import { Uri } from 'vscode';
import type { IExtensionContext } from './types';
import { noop } from './utils/misc';
import { getCurrentTempDirName, TEMP_DIR_PREFIX } from './temp';
import { logger } from '../logging';

// WARNING: Do not move this into `temp.ts` as this is specific to node extension.
// using native fs is faster than using vscode.workspace.fs.
// WARNING: Do not move this into `temp.ts` as this is specific to node extension.
// using native fs is faster than using vscode.workspace.fs.
// WARNING: Do not move this into `temp.ts` as this is specific to node extension.
// using native fs is faster than using vscode.workspace.fs.
// WARNING: Do not move this into `temp.ts` as this is specific to node extension.
// using native fs is faster than using vscode.workspace.fs.

/**
 * Delete old temp directories that are no longer required.
 * We create temporary directories in global storage directory as thats guaranteed to be read-write.
 * We need to delete these directories when they are no longer required.
 *
 * E.g. when users install a new version of the extension, then old files are no longer required.
 * This way the temporary directories are not left behind & cleaned up.
 *
 * We used to store temp files in os.tmpdir, but that's not guaranteed to be read-write.
 * Found cases where that failed.
 * We also used to store files in extension sub directory, but that's not guaranteed to be read-write.
 *
 * No need to move this into `temp.ts` as this is specific to node extension.
 * & using native fs is faster than using vscode.workspace.fs.
 * @param context
 */
export async function deleteOldTempDirs(context: IExtensionContext) {
    const dirs = await fs.readdir(context.globalStorageUri.fsPath).catch(() => []);
    const currentTempDir = getCurrentTempDirName(context);
    await Promise.all(
        dirs
            .filter((dir) => dir.startsWith(TEMP_DIR_PREFIX) && dir !== currentTempDir)
            .map((dir) => {
                const dirToDelete = Uri.joinPath(context.globalStorageUri, dir).fsPath;
                logger.info(`Deleting old temp dir ${dirToDelete}`);
                return fs.remove(dirToDelete);
            })
    ).catch(noop);
}
