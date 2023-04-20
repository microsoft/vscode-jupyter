// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';

/**
 * Returns the workspace folder this interpreter is based in or the root if not a virtual env
 */
export function getInterpreterWorkspaceFolder(
    interpreter: PythonEnvironment,
    workspaceService: IWorkspaceService
): Uri | undefined {
    const folder = workspaceService.getWorkspaceFolder(interpreter.uri);
    return folder?.uri || workspaceService.rootFolder;
}
