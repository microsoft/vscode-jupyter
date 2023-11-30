// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, workspace } from 'vscode';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { Environment } from '@vscode/python-extension';
import { getRootFolder } from '../../common/application/workspace.base';

/**
 * Returns the workspace folder this interpreter is based in or the root if not a virtual env
 */
export function getInterpreterWorkspaceFolder(interpreter: PythonEnvironment | Environment): Uri | undefined {
    const uri =
        'executable' in interpreter ? interpreter.executable.uri || Uri.file(interpreter.path) : interpreter.uri;
    const folder = workspace.getWorkspaceFolder(uri);
    return folder?.uri || getRootFolder();
}
