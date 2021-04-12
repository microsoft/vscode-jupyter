// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as path from 'path';
import { NotebookCellKind, NotebookCell, Uri, NotebookCellMetadata } from 'vscode';

import { IWorkspaceService } from '../common/application/types';
import { IFileSystem } from '../common/platform/types';

import { concatMultilineString } from '../../datascience-ui/common';
import { IConfigurationService } from '../common/types';
import { CellState, ICell } from './types';
import { NotebookCellRunState } from './jupyter/kernels/types';

export async function calculateWorkingDirectory(
    configService: IConfigurationService,
    workspace: IWorkspaceService,
    fs: IFileSystem
): Promise<string | undefined> {
    let workingDir: string | undefined;
    // For a local launch calculate the working directory that we should switch into
    const settings = configService.getSettings(undefined);
    const fileRoot = settings.notebookFileRoot;

    // If we don't have a workspace open the notebookFileRoot seems to often have a random location in it (we use ${workspaceRoot} as default)
    // so only do this setting if we actually have a valid workspace open
    if (fileRoot && workspace.hasWorkspaceFolders) {
        const workspaceFolderPath = workspace.workspaceFolders![0].uri.fsPath;
        if (path.isAbsolute(fileRoot)) {
            if (await fs.localDirectoryExists(fileRoot)) {
                // User setting is absolute and exists, use it
                workingDir = fileRoot;
            } else {
                // User setting is absolute and doesn't exist, use workspace
                workingDir = workspaceFolderPath;
            }
        } else if (!fileRoot.includes('${')) {
            // fileRoot is a relative path, combine it with the workspace folder
            const combinedPath = path.join(workspaceFolderPath, fileRoot);
            if (await fs.localDirectoryExists(combinedPath)) {
                // combined path exists, use it
                workingDir = combinedPath;
            } else {
                // Combined path doesn't exist, use workspace
                workingDir = workspaceFolderPath;
            }
        } else {
            // fileRoot is a variable that hasn't been expanded
            workingDir = fileRoot;
        }
    }
    return workingDir;
}

export function translateCellToNative(
    cell: ICell,
    language: string
): (Partial<NotebookCell> & { code: string }) | undefined {
    if (cell && cell.data && cell.data.source) {
        const query = '?query#';
        return {
            index: 0,
            metadata: new NotebookCellMetadata(),
            latestExecutionSummary: {
                executionOrder: cell.data.execution_count as number,
                success: true,
                duration: 0
            },
            outputs: [],
            kind: NotebookCellKind.Code,
            code: concatMultilineString(cell.data.source),
            document: {
                languageId: language,
                getText: () => concatMultilineString(cell.data.source),
                uri: Uri.parse(cell.file + query + cell.id)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
        };
    }
}

export function translateCellStateFromNative(state: NotebookCellRunState): CellState {
    switch (state) {
        case NotebookCellRunState.Error:
            return CellState.error;
        case NotebookCellRunState.Idle:
            return CellState.init;
        case NotebookCellRunState.Running:
            return CellState.executing;
        case NotebookCellRunState.Success:
            return CellState.finished;
        default:
            return CellState.init;
    }
}
