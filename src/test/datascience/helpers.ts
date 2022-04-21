/* eslint-disable local-rules/dont-use-fspath */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { traceInfo } from '../../platform/logging';

export async function openNotebook(ipynbFile: vscode.Uri) {
    traceInfo(`Opening notebook ${getFilePath(ipynbFile)}`);
    const nb = await vscode.workspace.openNotebookDocument(ipynbFile);
    await vscode.window.showNotebookDocument(nb);
    traceInfo(`Opened notebook ${getFilePath(ipynbFile)}`);
    return nb;
}
