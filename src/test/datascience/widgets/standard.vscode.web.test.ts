// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as vscode from 'vscode';
import * as urlPath from '../../../platform/vscode-path/resources';
import { startJupyterServer } from '../notebook/helper.web';
import { sharedIPyWidgetsTests } from './standard.vscode.common';

suite('Standard IPyWidget (Execution) (slow) (WIDGET_TEST) web', function () {
    const notebookRoot =
        vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? urlPath.joinPath(
                  vscode.workspace.workspaceFolders[0].uri,
                  'src',
                  'test',
                  'datascience',
                  'widgets',
                  'notebooks'
              )
            : vscode.Uri.file('');

    // Use the shared code that runs the tests
    sharedIPyWidgetsTests(this, notebookRoot, (n) => {
        return startJupyterServer(n);
    });
});
