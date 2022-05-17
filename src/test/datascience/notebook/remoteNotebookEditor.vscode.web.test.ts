// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { startJupyterServer } from './helper.web';
import { sharedRemoteNotebookEditorTests } from './remoteNotebookEditor.vscode.common';

suite('DataScience - VSCode Notebook - (Remote) (Execution) (slow)', function () {
    // Use the shared code that runs the tests
    sharedRemoteNotebookEditorTests(
        this,
        async (n) => {
            return startJupyterServer(n);
        },
        (_s) => {
            // Don't have any custom tests so don't need the service container
        },
        async () => {
            // Don't have any custom tests so don't need a post setup callback
        },
        async () => {
            // No post test steps to run
        }
    );
});
