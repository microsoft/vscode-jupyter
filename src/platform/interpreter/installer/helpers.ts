// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { Environment } from '@vscode/python-extension';

/**
 * Returns the workspace folder this interpreter is based in or the root if not a virtual env
 */
export function getInterpreterWorkspaceFolder(
    interpreter: PythonEnvironment | Environment,
    workspaceService: IWorkspaceService
): Uri | undefined {
    const uri =
        'executable' in interpreter ? interpreter.executable.uri || Uri.file(interpreter.path) : interpreter.uri;
    const folder = workspaceService.getWorkspaceFolder(uri);
    return folder?.uri || workspaceService.rootFolder;
}
