// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as path from '../../../platform/vscode-path/path';
import * as vscode from 'vscode';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';
import { startJupyterServer } from '../notebook/helper.node';
import { sharedIPyWidgetsTests } from './standard.vscode.common';

suite('Standard IPyWidget (Execution) (slow) (WIDGET_TEST) node', function () {
    const notebookPath = vscode.Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'widgets', 'notebooks')
    );

    // Use the shared code that runs the tests
    sharedIPyWidgetsTests(this, notebookPath, (n) => {
        return startJupyterServer(n);
    });
});
